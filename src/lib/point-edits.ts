import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { QUEUE_LIMIT } from "./moderation";

// Propozycje zmian punktu od użytkowników (`pointEdits`, functions/point_edits.js).
// Pisze je tylko serwer; panel czyta otwarte i decyduje przez callable.

export type EditFields = Partial<{
  name: string;
  type: string;
  phone: string | null;
  // null = remove the description (stage 2 of the optional description, 1118).
  description: string | null;
  lat: number;
  lon: number;
  // Gastronomy tag the author changed (true or false), see `@/lib/gastro`.
  gastro: boolean;
}>;

export type EditBase = {
  name: string | null;
  type: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  description: string | null;
  // The document's own tag, null = no opinion (the asset decides).
  gastro: boolean | null;
};

export type PointEditItem = {
  id: string;
  pointId: string;
  uid: string;
  authorName: string;
  base: EditBase;
  proposed: EditFields;
  removePhotoIds: string[];
  at: number | null;
};

function millis(ts: unknown): number | null {
  const v = ts as { toMillis?: () => number } | null;
  return v && typeof v.toMillis === "function" ? v.toMillis() : null;
}

function mapEdit(d: Record<string, unknown>, id: string): PointEditItem {
  const base = (d.base ?? {}) as EditBase;
  return {
    id,
    pointId: String(d.pointId ?? ""),
    uid: String(d.uid ?? ""),
    authorName: typeof d.name === "string" && d.name ? d.name : "Użytkownik",
    base: {
      name: base.name ?? null,
      type: base.type ?? null,
      lat: base.lat ?? null,
      lon: base.lon ?? null,
      phone: base.phone ?? null,
      description: base.description ?? null,
      gastro: typeof base.gastro === "boolean" ? base.gastro : null,
    },
    proposed: (d.proposed ?? {}) as EditFields,
    removePhotoIds: Array.isArray(d.removePhotoIds)
      ? d.removePhotoIds.filter((x): x is string => typeof x === "string")
      : [],
    at: millis(d.at),
  };
}

/** Otwarte propozycje, najstarsze pierwsze (indeks status ASC, at ASC). */
export function watchPointEditsQueue(cb: (items: PointEditItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(
    collection(db, "pointEdits"),
    where("status", "==", "open"),
    orderBy("at", "asc"),
    limit(QUEUE_LIMIT),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => mapEdit(d.data(), d.id))), onErr);
}

/**
 * Zatwierdzenie wprowadza zmiany i zdejmuje zdjęcia; odrzucenie wymaga powodu.
 * `expectedAt` to `at` propozycji TAK, JAK widział je ten panel (user 1117
 * ultrareview #1): backend porównuje je z aktualnym `at` w bazie i odrzuca
 * decyzję, jeśli ktoś zresubmitował propozycję w międzyczasie — inaczej
 * moderator zatwierdzałby treść, której nigdy nie widział.
 */
export async function decidePointEdit(
  editId: string,
  approve: boolean,
  expectedAt: number | null,
  reason?: string,
): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorPointEditDecision");
  await fn({ editId, approve, expectedAt, reason: reason ?? "" });
}
