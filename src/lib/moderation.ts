import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

export type ModState =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_review"
  | "reviewing";

export const QUEUE_LIMIT = 200;
export const BROWSE_LIMIT = 400;

function millis(ts: unknown): number | null {
  const v = ts as { toMillis?: () => number } | null;
  return v && typeof v.toMillis === "function" ? v.toMillis() : null;
}

// ── Kolejka (needs_review) + zgłoszenia ──────────────────────────────────────
export type CommentItem = {
  pointId: string;
  commentId: string;
  authorName: string;
  authorUid: string;
  text: string;
  status: string;
  state: ModState;
  labels: string[];
  reportCount: number;
  createdAt: number | null;
  isTest: boolean;
};

export type DescriptionItem = {
  pointId: string;
  name: string;
  description: string;
  status: string;
  state: ModState;
  labels: string[];
  authorName: string;
  authorUid: string;
  createdAt: number | null;
  isTest: boolean;
  lat: number | null;
  lon: number | null;
  type: string;
  waterNearby: boolean;
  fireSpot: boolean;
  overnight: boolean;
  emergencyShelter: boolean;
};

export type ReportItem = {
  id: string;
  target: "point" | "description" | "comment";
  pointId: string;
  commentId: string | null;
  flag: string | null;
  category: string | null;
  reason: string | null;
  reporterUid: string;
  createdAt: number | null;
  isTest: boolean;
};

export type LogItem = {
  id: string;
  targetType: string;
  pointId: string | null;
  commentId: string | null;
  text: string;
  ai: { state?: string; labels?: string[]; score?: number; reason?: string; model?: string } | null;
  human: { state?: string; reviewerUid?: string } | null;
  final: { state?: string } | null;
  overrodeAI: boolean;
  source: string;
  createdAt: number | null;
  isTest: boolean;
};

function isSmokeId(...ids: (string | null | undefined)[]): boolean {
  return ids.some((id) => typeof id === "string" && id.startsWith("SMOKE"));
}

function mapComment(d: DocumentData, id: string, pointId: string): CommentItem {
  return {
    pointId,
    commentId: id,
    authorName: d.authorName ?? "",
    authorUid: d.authorUid ?? "",
    text: d.text ?? "",
    status: d.status ?? "active",
    state: (d.moderation?.state ?? "approved") as ModState,
    labels: Array.isArray(d.moderation?.labels) ? d.moderation.labels : [],
    reportCount: d.reportCount ?? 0,
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(pointId, id, d.authorUid, d.authorName),
  };
}

function mapDescription(d: DocumentData, id: string): DescriptionItem {
  return {
    pointId: id,
    name: d.name ?? "",
    description: d.description ?? "",
    status: d.status ?? "active",
    state: (d.moderation?.state ?? "approved") as ModState,
    labels: Array.isArray(d.moderation?.labels) ? d.moderation.labels : [],
    authorName: d.authorName ?? "",
    authorUid: d.authorUid ?? "",
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(id, d.authorUid, d.authorName),
    lat: typeof d.lat === "number" ? d.lat : null,
    lon: typeof d.lon === "number" ? d.lon : null,
    type: d.type ?? "",
    waterNearby: !!d.waterNearby,
    fireSpot: !!d.fireSpot,
    overnight: !!d.overnight,
    emergencyShelter: !!d.emergencyShelter,
  };
}

function mapReport(d: DocumentData, id: string): ReportItem {
  return {
    id,
    target: d.target ?? "comment",
    pointId: d.pointId ?? "",
    commentId: d.commentId ?? null,
    flag: d.flag ?? null,
    category: d.category ?? null,
    reason: d.reason ?? null,
    reporterUid: d.reporterUid ?? "",
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(d.pointId, d.commentId, d.reporterUid),
  };
}

function mapLog(d: DocumentData, id: string): LogItem {
  return {
    id,
    targetType: d.targetType ?? "",
    pointId: d.pointId ?? null,
    commentId: d.commentId ?? null,
    text: d.text ?? "",
    ai: d.ai ?? null,
    human: d.human ?? null,
    final: d.final ?? null,
    overrodeAI: !!d.overrodeAI,
    source: d.source ?? "",
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(d.pointId, d.commentId, d.authorUid),
  };
}

const byNewest = (a: { createdAt: number | null }, b: { createdAt: number | null }) =>
  (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity);

/** Komentarze needs_review (collectionGroup) — live. */
export function watchCommentsQueue(cb: (items: CommentItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(
    collectionGroup(db, "comments"),
    where("moderation.state", "==", "needs_review"),
    limit(QUEUE_LIMIT),
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot) => {
      const out = snap.docs.map((d) =>
        mapComment(d.data(), d.id, d.ref.parent.parent?.id ?? ""),
      );
      out.sort(byNewest);
      cb(out);
    },
    onErr,
  );
}

/** Opisy needs_review (points) — live. */
export function watchDescriptionsQueue(cb: (items: DescriptionItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(
    collection(db, "points"),
    where("moderation.state", "==", "needs_review"),
    limit(QUEUE_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out = snap.docs
        .map((d) => mapDescription(d.data(), d.id))
        .filter((p) => p.description.length > 0);
      out.sort(byNewest);
      cb(out);
    },
    onErr,
  );
}

/** Otwarte zgłoszenia — live. */
export function watchReportsQueue(cb: (items: ReportItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(collection(db, "reports"), where("status", "==", "open"), limit(QUEUE_LIMIT));
  return onSnapshot(
    q,
    (snap) => {
      const out = snap.docs.map((d) => mapReport(d.data(), d.id));
      out.sort(byNewest);
      cb(out);
    },
    onErr,
  );
}

/** Historia decyzji (moderationLog), najnowsze pierwsze — live. */
export function watchHistory(cb: (items: LogItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(collection(db, "moderationLog"), orderBy("createdAt", "desc"), limit(BROWSE_LIMIT));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => mapLog(d.data(), d.id))), onErr);
}

/** Wszystkie komentarze (każdy stan). */
export async function fetchAllComments(): Promise<CommentItem[]> {
  const snap = await getDocs(query(collectionGroup(db, "comments"), limit(BROWSE_LIMIT)));
  const out = snap.docs.map((d) => mapComment(d.data(), d.id, d.ref.parent.parent?.id ?? ""));
  out.sort(byNewest);
  return out;
}

/** Wszystkie opisy (każdy stan). */
export async function fetchAllDescriptions(): Promise<DescriptionItem[]> {
  const snap = await getDocs(query(collection(db, "points"), limit(BROWSE_LIMIT)));
  const out = snap.docs.map((d) => mapDescription(d.data(), d.id)).filter((p) => p.description.length > 0);
  out.sort(byNewest);
  return out;
}

// ── Decyzja moderatora (callable) ────────────────────────────────────────────
type DecisionInput = {
  action:
    | "approveComment"
    | "rejectComment"
    | "approveDescription"
    | "rejectDescription"
    | "closeReport";
  pointId?: string;
  commentId?: string;
  reportId?: string;
  resolution?: "actioned" | "dismissed";
};

export async function decide(input: DecisionInput): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorDecision");
  await fn(input);
}

// ── Blokada/odblokowanie konta autora (callable setUserBlock) ────────────────
// Pisze/kasuje moderationBlocks/{targetUid} po stronie serwera (admin SDK). Ban
// działa natychmiast (reguły isNotBlocked czytają istnienie dokumentu) i nie
// znika po skasowaniu profilu przez usera.
export async function setUserBlock(
  targetUid: string,
  blocked: boolean,
  reason?: string,
): Promise<void> {
  const fn = httpsCallable(functions, "setUserBlock");
  await fn({ targetUid, blocked, reason });
}

/** Odblokowanie autora — kasuje moderationBlocks/{uid} (setUserBlock blocked=false). */
export async function unblockUser(targetUid: string): Promise<void> {
  await setUserBlock(targetUid, false);
}

// ── Edycja / usuwanie punktu przez moderatora (callable) ─────────────────────
// Kuratorska edycja i twarde usunięcie punktu. Oba przez callable serwerowy
// (admin SDK omija reguły, weryfikuje role==moderator). Edycja treści
// (nazwa/opis) zapisuje po stronie serwera moderation=approved + contentHash, więc
// onPointModeration NIE re-moderuje zaufanej poprawki. Delete kaskaduje komentarze.
export type PointEditFields = Partial<{
  name: string | null;
  description: string | null;
  type: string;
  lat: number;
  lon: number;
  waterNearby: boolean;
  fireSpot: boolean;
  overnight: boolean;
  emergencyShelter: boolean;
}>;

/** Zapisuje zmienione pola punktu (tylko podane wchodzą do update). */
export async function editPoint(pointId: string, fields: PointEditFields): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorEditPoint");
  await fn({ pointId, fields });
}

// ── Ręczne dodanie punktu (callable onModeratorCreatePoint) ──────────────────
// Punkt powstaje jako `points/UGC:<autoId>` — kuratorowana baza siedzi w
// ZBUNDLOWANYM assecie apki, więc dopisanie do niej wymagałoby nowego wydania.
// Serwer zapisuje moderation=human/approved + contentHash (bez re-moderacji Gemini)
// i podpisuje punkt jako „Zespół Hyc!". Opis opcjonalny — punkt bez opisu też jest
// widoczny na mapie (apka pokaże baner „Zostań pionierem").
export type PointCreateFields = {
  name: string;
  type: string;
  lat: number;
  lon: number;
  description?: string;
  waterNearby?: boolean;
  fireSpot?: boolean;
  overnight?: boolean;
  emergencyShelter?: boolean;
};

/**
 * Punkty dodane ręcznie z panelu (`createdVia == "moderation-panel"`) — live.
 * Osobny strumień, bo lista „Wszystkie treści" pokazuje tylko punkty Z OPISEM, a
 * ręczny punkt bez opisu jest legalny — bez tego widoku nie dałoby się go potem
 * ani poprawić, ani usunąć. Sort po dacie w kliencie (bez indeksu złożonego).
 */
export function watchManualPoints(
  cb: (items: DescriptionItem[]) => void,
  onErr: (e: unknown) => void,
) {
  const q = query(
    collection(db, "points"),
    where("createdVia", "==", "moderation-panel"),
    limit(BROWSE_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out = snap.docs.map((d) => mapDescription(d.data(), d.id));
      out.sort(byNewest);
      cb(out);
    },
    onErr,
  );
}

/** Tworzy nowy punkt UGC. Zwraca nadane `UGC:<id>`. */
export async function createPoint(fields: PointCreateFields): Promise<string> {
  const fn = httpsCallable<{ fields: PointCreateFields }, { pointId: string }>(
    functions,
    "onModeratorCreatePoint",
  );
  const res = await fn({ fields });
  return res.data.pointId;
}

/** Twarde usunięcie punktu (+ kaskada komentarzy) z bazy. Nieodwracalne. */
export async function deletePoint(pointId: string): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorDeletePoint");
  await fn({ pointId });
}

// ── Lista zablokowanych (moderationBlocks) ───────────────────────────────────
export type BlockedItem = {
  uid: string;
  blockedBy: string;
  reason: string;
  blockedAt: number | null;
};

function mapBlocked(d: DocumentData, id: string): BlockedItem {
  return {
    uid: id,
    blockedBy: d.blockedBy ?? "",
    reason: d.reason ?? "",
    blockedAt: millis(d.blockedAt),
  };
}

/** Zablokowani autorzy — live (moderationBlocks, read: isMod). */
export function watchBlockedUsers(cb: (items: BlockedItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(collection(db, "moderationBlocks"), limit(BROWSE_LIMIT));
  return onSnapshot(
    q,
    (snap) => {
      const out = snap.docs.map((d) => mapBlocked(d.data(), d.id));
      out.sort((a, b) => (b.blockedAt ?? -Infinity) - (a.blockedAt ?? -Infinity));
      cb(out);
    },
    onErr,
  );
}

// ── Podgląd celu zgłoszenia (resolve pojedynczego dokumentu) ─────────────────
/** Komentarz po ścieżce points/{pointId}/comments/{commentId} (podgląd w zgłoszeniu). */
export async function fetchCommentById(pointId: string, commentId: string): Promise<CommentItem | null> {
  const snap = await getDoc(doc(db, "points", pointId, "comments", commentId));
  return snap.exists() ? mapComment(snap.data(), snap.id, pointId) : null;
}

/** Opis punktu po points/{pointId} (podgląd w zgłoszeniu). */
export async function fetchDescriptionById(pointId: string): Promise<DescriptionItem | null> {
  const snap = await getDoc(doc(db, "points", pointId));
  return snap.exists() ? mapDescription(snap.data(), snap.id) : null;
}
