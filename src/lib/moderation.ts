import {
  collection,
  collectionGroup,
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

const QUEUE_LIMIT = 200;
const BROWSE_LIMIT = 400;

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
  authorName: string;
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
    authorName: d.authorName ?? "",
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
