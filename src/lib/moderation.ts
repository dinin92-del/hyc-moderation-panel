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
  /** Numer kontaktowy punktu — pole SERWEROWE, wpisywane tylko z panelu. */
  phone: string | null;
  /** `moderation-panel` dla punktów wpisanych ręcznie z panelu (podpis „Zespół Hyc!"). */
  createdVia: string | null;
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
  /** `open` | `closed` — zamknięte zgłoszenia widać tylko w „Wszystkie treści". */
  status: string;
  /** Rozwiązanie zamkniętego zgłoszenia: `actioned` | `dismissed` | null (otwarte). */
  resolution: string | null;
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
    phone: typeof d.phone === "string" && d.phone.trim() !== "" ? d.phone : null,
    createdVia: d.createdVia ?? null,
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
    status: d.status ?? "open",
    resolution: d.resolution ?? null,
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

/** Wszystkie komentarze (każdy stan). `take` = ile pobrać (paginacja „Załaduj więcej"). */
export async function fetchAllComments(take: number = BROWSE_LIMIT): Promise<CommentItem[]> {
  const snap = await getDocs(query(collectionGroup(db, "comments"), limit(take)));
  const out = snap.docs.map((d) => mapComment(d.data(), d.id, d.ref.parent.parent?.id ?? ""));
  out.sort(byNewest);
  return out;
}

/**
 * Punkty i opisy do przeglądu — DWA CELOWANE zapytania zamiast jednego „daj
 * wszystko z `points`".
 *
 * ⛔ Czemu nie jedno zapytanie: `points` trzyma nie tylko treść od userów, ale i
 * SETKI nakładek kuratorowanych (sam telefon albo atrybuty, bez opisu). Ślepe
 * `limit(N)` na całej kolekcji zjadały te nakładki, a prawdziwa treść wypadała
 * za limit — najpierw wszystkie `UGC:*` (bo bez `orderBy` Firestore sortuje po
 * ID, a `'O' < 'U'`), a po dołożeniu `orderBy(createdAt)` wypadały starsze
 * opisy. Widok meldował wtedy „Nowe punkty (0)" / „Opisy (0)" i wyglądał na
 * pusty przy pełnej bazie.
 *
 * Dlatego pytamy o dwie rozłączne grupy po polach, które MAJĄ tylko one:
 *   • nowe punkty — `source == "ugc"` (punkt z apki albo z panelu),
 *   • opisy — `descriptionAddedAt` istnieje (pole zapisywane przy dodaniu
 *     opisu; nakładka bez opisu go nie ma, więc `orderBy` ją pomija).
 * Obie grupy mogą się przeciąć (punkt UGC z opisem) — deduplikuje [fetchContentPoints].
 */
export async function fetchContentPoints(
  take: number = BROWSE_LIMIT,
): Promise<{ newPoints: DescriptionItem[]; described: DescriptionItem[]; truncated: boolean }> {
  const [ugcSnap, descSnap] = await Promise.all([
    // Sam filtr równościowy — bez `orderBy`, więc bez indeksu złożonego.
    getDocs(query(collection(db, "points"), where("source", "==", "ugc"), limit(take))),
    getDocs(query(collection(db, "points"), orderBy("descriptionAddedAt", "desc"), limit(take))),
  ]);
  const newPoints = ugcSnap.docs.map((d) => mapDescription(d.data(), d.id));
  const ugcIds = new Set(newPoints.map((p) => p.pointId));
  const described = descSnap.docs
    .map((d) => mapDescription(d.data(), d.id))
    // Punkt UGC z opisem jest już w `newPoints` — w widoku ma być JEDNYM wierszem.
    .filter((p) => !ugcIds.has(p.pointId) && p.description.length > 0);
  newPoints.sort(byNewest);
  described.sort(byNewest);
  return {
    newPoints,
    described,
    truncated: ugcSnap.size >= take || descSnap.size >= take,
  };
}

/**
 * Punkty po ID — do WYŚWIETLENIA NAZWY przy komentarzu/zgłoszeniu, którego
 * rodzic nie zmieścił się w [fetchAllPoints]. Bez tego wiersz pokazuje gołe
 * `UGC:...` zamiast nazwy, którą user widzi w aplikacji. Brakujące dokumenty
 * (punkt usunięty) po prostu nie wracają.
 */
export async function fetchPointsByIds(ids: string[]): Promise<DescriptionItem[]> {
  const snaps = await Promise.all(
    ids.map((id) => getDoc(doc(db, "points", id)).catch(() => null)),
  );
  const out: DescriptionItem[] = [];
  for (const s of snaps) {
    const data = s?.data();
    if (data) out.push(mapDescription(data, s!.id));
  }
  return out;
}

/** Wszystkie zgłoszenia (otwarte i zamknięte), najnowsze pierwsze. */
export async function fetchAllReports(take: number = BROWSE_LIMIT): Promise<ReportItem[]> {
  const snap = await getDocs(query(collection(db, "reports"), limit(take)));
  const out = snap.docs.map((d) => mapReport(d.data(), d.id));
  out.sort(byNewest);
  return out;
}

/**
 * Historia decyzji JEDNEJ treści (moderationLog po pointId/commentId).
 * Bez `orderBy` w zapytaniu (równość + sort po innym polu wymagałaby indeksu
 * złożonego) — sort po stronie klienta; wpisów per treść jest garść.
 */
export async function fetchLogFor(pointId: string, commentId: string | null): Promise<LogItem[]> {
  // ⛔ Odsiew po `targetType` musi być W ZAPYTANIU, nie po stronie klienta.
  // `limit` obowiązuje PRZED filtrem klienckim, więc punkt z żywą dyskusją
  // (dużo wpisów komentarzy) wypełniał okno logami komentarzy, a po odfiltrowaniu
  // zostawała garść wpisów opisu — historia wyglądała na kompletną i nie była.
  const clauses = [
    where("pointId", "==", pointId),
    where("targetType", "==", commentId ? "comment" : "description"),
  ];
  if (commentId) clauses.push(where("commentId", "==", commentId));
  const snap = await getDocs(query(collection(db, "moderationLog"), ...clauses, limit(50)));
  const out = snap.docs.map((d) => mapLog(d.data(), d.id));
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
  /** Numer kontaktowy; `null` czyści pole w dokumencie. */
  phone: string | null;
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
  /** Numer kontaktowy punktu (opcjonalny; walidacja po stronie callable). */
  phone?: string;
};

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
