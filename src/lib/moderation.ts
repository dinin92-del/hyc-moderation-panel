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
  /**
   * Pole `authorUid` NIEOBECNE w dokumencie: serwer je wyczyścił, autora zna
   * tylko `contributionAuthors`. `null` w polu (zespół, konto skasowane) to
   * NIE jest wyczyszczenie, więc indeksu nie pytamy. Patrz [authorFieldCleared].
   */
  authorCleared: boolean;
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
  /** Jak [CommentItem.authorCleared], dla `authorUid` punktu. */
  authorCleared: boolean;
  createdAt: number | null;
  isTest: boolean;
  lat: number | null;
  lon: number | null;
  type: string;
  /** Numer kontaktowy punktu — pole SERWEROWE, wpisywane tylko z panelu. */
  phone: string | null;
  /** Numer od użytkownika czekający na werdykt, publiczny dopiero po nim. */
  phonePending: string | null;
  /** Dokument `points/{id}` istnieje. Punkt z assetu zwykle go nie ma. */
  hasDoc: boolean;
  /** Punkt jest w assecie, więc pozycji nie zmienia się z panelu. */
  inAsset: boolean;
  /** Pochodzenie widoczne na karcie punktu. */
  origin: PointOrigin;
  /** Moderator poprawił punkt, więc nazwa i typ idą z dokumentu. */
  moderatorEdited: boolean;
  /** Dane z assetu, null dla UGC. Karta punktu pokazuje je obok dokumentu. */
  base: PointBase | null;
  /** `moderation-panel` dla punktów wpisanych ręcznie z panelu (podpis „Zespół Hyc!"). */
  createdVia: string | null;
  /**
   * Autor OPISU — osobny od autora dokumentu. Opis dopisany do istniejącego
   * punktu (ścieżka update) NIE zmienia `authorUid`, więc bez tych pól panel
   * przypisywał cudzy opis twórcy punktu. Null = dokument sprzed #615 —
   * atrybucję rozstrzyga [descriptionContributor].
   */
  descriptionAuthorUid: string | null;
  /**
   * `descriptionAuthorUid` NIEOBECNE (wyczyszczone przez serwer albo dokument
   * sprzed #615). `null` w polu = opis zespołu (przejęty w panelu), bez autora.
   */
  descriptionAuthorCleared: boolean;
  descriptionAuthorName: string | null;
  descriptionAddedAt: number | null;
};

/**
 * Autor opisu do pokazania w panelu — LUSTRO `PointDoc.descriptionContributorName`
 * (lib/core/models/point_doc.dart, #615). Rozjazd tych dwóch kopii znaczy, że
 * panel przypisuje opis komu innemu niż aplikacja pokazuje userowi.
 *
 * Nowe dokumenty niosą autora wprost. Dla dokumentów legacy autor jest znany
 * TYLKO, gdy opis wszedł razem z utworzeniem dokumentu (`createdAt` ≈
 * `descriptionAddedAt`, jeden zapis — tolerancja 2 min). Opis dopisany później
 * przez kogoś innego → null: BRAK atrybucji zamiast fałszywego przypisania
 * twórcy punktu. To nie jest ostrożność dla ozdoby — przy tym wierszu stoi
 * „Zablokuj autora opisu".
 */
const LEGACY_SAME_WRITE_MS = 2 * 60 * 1000;
export function descriptionContributor(
  p: DescriptionItem,
): { name: string; uid: string | null } | null {
  const explicit = p.descriptionAuthorName?.trim();
  if (explicit) return { name: explicit, uid: p.descriptionAuthorUid };
  if (
    p.createdAt !== null &&
    p.descriptionAddedAt !== null &&
    Math.abs(p.descriptionAddedAt - p.createdAt) <= LEGACY_SAME_WRITE_MS
  ) {
    return p.authorName.trim() ? { name: p.authorName, uid: p.authorUid } : null;
  }
  return null;
}

/**
 * Data OPISU — jedno źródło prawdy dla wiersza, który jest opisem (kolejka
 * „Opisy do sprawdzenia" i wiersz `description` w „Wszystkich treściach").
 *
 * ⛔ `createdAt` to data powstania PUNKTU i dla opisu jest zwyczajnie inną datą.
 * Opis dopisany do cudzego (albo firmowego) punktu nie zmienia `createdAt`, więc
 * kolumna „Data" pokazywała, kiedy punkt trafił do bazy — czasem miesiąc przed
 * powstaniem opisu, o którego moderacji ten wiersz decyduje. Zgłoszone przez
 * usera 0818 na `Schronisko PTTK na Szyndzielni`: opis z 17.08 podpisany datą
 * 23.07 (utworzenie punktu przez „Zespół Hyc!").
 *
 * ⚠ Data jest też KLUCZEM SORTU — po `createdAt` świeży opis na starym punkcie
 * wpada między stare wiersze i przy stronie 50 pozycji moderator go nie widzi.
 *
 * ⛔ BEZ fallbacku na `createdAt`, gdy pola brak (dokument sprzed
 * `descriptionAddedAt`). Fallback wyglądałby na ostrożny, a przywracałby
 * DOKŁADNIE naprawiany błąd — datę punktu podpisaną jako datę opisu — i to
 * cicho, w jedynym miejscu, gdzie w ogóle mógłby się odpalić: `orderBy` w
 * [fetchContentPoints] pomija dokumenty bez tego pola, więc żywą ścieżką
 * zostaje sama kolejka. Nie wiemy, kiedy opis powstał → `fmtDate` pokaże „—".
 * Ten sam standard dowodu, co [descriptionContributor]: brak atrybucji zamiast
 * fałszywej.
 */
export function descriptionDate(p: DescriptionItem): number | null {
  return p.descriptionAddedAt;
}

export type PointOrigin = "asset" | "overlay" | "ugc";

export type PointBase = { name: string; type: string; lat: number; lon: number };

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
  decisionReason: string | null;
  resolvedAt: number | null;
};

export type LogItem = {
  id: string;
  targetType: string;
  pointId: string | null;
  commentId: string | null;
  text: string;
  ai: { state?: string; labels?: string[]; score?: number; reason?: string; model?: string } | null;
  human: { state?: string; reviewerUid?: string; reason?: string } | null;
  final: { state?: string } | null;
  changedFields: string[];
  overrodeAI: boolean;
  source: string;
  createdAt: number | null;
  isTest: boolean;
};

/**
 * Trzy stany pola autora, lustro `authorFieldState` w functions/author_index.js
 * (repo aplikacji): string = autor w polu, brak pola = wyczyszczone (autor
 * w `contributionAuthors`), `null` = autora nie ma (punkt zespołowy, opis
 * przejęty przez zespół, konto skasowane). Tylko brak pola uprawnia do
 * odpytania indeksu: przy `null` indeks może jeszcze pamiętać dawnego autora,
 * a za tym wierszem stoi „Zablokuj autora".
 */
function authorFieldCleared(d: DocumentData, field: string): boolean {
  return !(field in d) || d[field] === undefined;
}

// Tylko id/uid (nadawane przez system). Nigdy authorName: to wyświetlana nazwa wybierana przez usera,
// więc „SMOKE…” w nazwie ukryłoby prawdziwe wpisy przed moderatorem przy „Ukryj testowe”.
function isSmokeId(...ids: (string | null | undefined)[]): boolean {
  return ids.some((id) => typeof id === "string" && id.startsWith("SMOKE"));
}

function mapComment(d: DocumentData, id: string, pointId: string): CommentItem {
  return {
    pointId,
    commentId: id,
    authorName: d.authorName ?? "",
    authorUid: typeof d.authorUid === "string" ? d.authorUid : "",
    authorCleared: authorFieldCleared(d, "authorUid"),
    text: d.text ?? "",
    status: d.status ?? "active",
    state: (d.moderation?.state ?? "approved") as ModState,
    labels: Array.isArray(d.moderation?.labels) ? d.moderation.labels : [],
    reportCount: d.reportCount ?? 0,
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(pointId, id, d.authorUid),
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
    authorUid: typeof d.authorUid === "string" ? d.authorUid : "",
    authorCleared: authorFieldCleared(d, "authorUid"),
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(id, d.authorUid),
    lat: typeof d.lat === "number" ? d.lat : null,
    lon: typeof d.lon === "number" ? d.lon : null,
    type: d.type ?? "",
    phone: typeof d.phone === "string" && d.phone.trim() !== "" ? d.phone : null,
    phonePending: typeof d.phonePending === "string" && d.phonePending !== "" ? d.phonePending : null,
    hasDoc: true,
    inAsset: false,
    origin: d.source === "ugc" ? "ugc" : "overlay",
    moderatorEdited: !!d.moderatorEdit,
    base: null,
    createdVia: d.createdVia ?? null,
    descriptionAuthorUid: typeof d.descriptionAuthorUid === "string" &&
      d.descriptionAuthorUid !== "" ? d.descriptionAuthorUid : null,
    descriptionAuthorCleared: authorFieldCleared(d, "descriptionAuthorUid"),
    descriptionAuthorName: d.descriptionAuthorName ?? null,
    descriptionAddedAt: millis(d.descriptionAddedAt),
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
    resolution: d.status === "actioned" || d.status === "dismissed" ? d.status : null,
    decisionReason: d.decisionReason ?? null,
    resolvedAt: millis(d.resolvedAt),
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
    changedFields: Array.isArray(d.changedFields) ? d.changedFields : [],
    overrodeAI: !!d.overrodeAI,
    source: d.source ?? "",
    createdAt: millis(d.createdAt),
    isTest: !!d._test || isSmokeId(d.pointId, d.commentId, d.authorUid),
  };
}

const byNewest = (a: { createdAt: number | null }, b: { createdAt: number | null }) =>
  (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity);

// Kolejka idzie od najstarszych: to one najdłużej czekają na decyzję.
const byOldest = (a: { createdAt: number | null }, b: { createdAt: number | null }) =>
  (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity);

// Stany czekające na człowieka. `pending` i `reviewing` powinny zejść same, więc
// wiszący dokument bez tego nie miałby w panelu żadnego miejsca.
const WAITING_STATES = ["needs_review", "pending", "reviewing"];

/** Sort listy OPISÓW — po dacie opisu, nie punktu. Patrz [descriptionDate]. */
const byNewestDescription = (a: DescriptionItem, b: DescriptionItem) =>
  (descriptionDate(b) ?? -Infinity) - (descriptionDate(a) ?? -Infinity);

/** Punkt bez opisu w kolejce to zdjęcia lub telefon, stąd data punktu na zapas. */
const queueDate = (p: DescriptionItem) => descriptionDate(p) ?? p.createdAt;

// ── Autor z odwrotnego indeksu (plan autor-prywatny-nick-1027) ──────────────
// Publiczne `authorUid` bywa wyczyszczone. Prawdę trzyma `contributionAuthors/
// {klucz}` ({uid, kind, path}; czyta moderator, pisze serwer), klucz jak w
// functions/author_index.js: `comment__pid__cid`, `point__pid`, `description__pid`,
// `photo__id`. Pole publiczne ma pierwszeństwo, indeks tylko dopełnia, i to
// wyłącznie dla pola NIEOBECNEGO (`authorCleared`), nigdy dla `null`.
const AUTHOR_MISS_TTL_MS = 60_000;
const authorCache = new Map<string, { uid: string; at: number }>();

async function lookupAuthorUid(key: string): Promise<string> {
  const hit = authorCache.get(key);
  // Trafienie żyje do końca sesji. Brak wpisu krótko, bo indeks powstaje chwilę
  // po treści (trigger), więc zbyt długi cache pustego wyniku ukryłby autora.
  if (hit && (hit.uid !== "" || Date.now() - hit.at < AUTHOR_MISS_TTL_MS)) return hit.uid;
  try {
    const snap = await getDoc(doc(db, "contributionAuthors", key));
    const uid = snap.exists() && typeof snap.data()?.uid === "string" ? snap.data()!.uid : "";
    authorCache.set(key, { uid, at: Date.now() });
    return uid;
  } catch {
    return "";
  }
}

/** Uzupełnia `authorUid` komentarzy z indeksu, gdy pole publiczne wyczyszczono. */
export async function fillCommentAuthors(items: CommentItem[]): Promise<CommentItem[]> {
  return Promise.all(
    items.map(async (c) => {
      if (c.authorUid || !c.authorCleared) return c;
      const authorUid = await lookupAuthorUid(`comment__${c.pointId}__${c.commentId}`);
      return authorUid ? { ...c, authorUid } : c;
    }),
  );
}

/**
 * Uzupełnia autora punktu i autora opisu. Punkty z panelu (`createdVia`) nie
 * mają autora z założenia, więc ich nie odpytujemy. Autora opisu szukamy tylko
 * wtedy, gdy opis jest, a pola brak.
 */
export async function fillDescriptionAuthors(
  items: DescriptionItem[],
): Promise<DescriptionItem[]> {
  return Promise.all(
    items.map(async (p) => {
      if (p.createdVia === "moderation-panel") return p;
      const authorUid = p.authorUid ||
        (p.authorCleared ? await lookupAuthorUid(`point__${p.pointId}`) : "");
      const descriptionAuthorUid =
        p.descriptionAuthorUid ||
        (p.description.length > 0 && p.descriptionAuthorCleared ?
          (await lookupAuthorUid(`description__${p.pointId}`)) || null : null);
      if (authorUid === p.authorUid && descriptionAuthorUid === p.descriptionAuthorUid) return p;
      return { ...p, authorUid, descriptionAuthorUid };
    }),
  );
}

/** Uzupełnia `authorUid` zdjęć z indeksu, gdy pole publiczne wyczyszczono. */
export async function fillPhotoAuthors(items: PhotoItem[]): Promise<PhotoItem[]> {
  return Promise.all(
    items.map(async (f) => {
      if (f.authorUid || !f.authorCleared) return f;
      const authorUid = await lookupAuthorUid(`photo__${f.id}`);
      return authorUid ? { ...f, authorUid } : f;
    }),
  );
}

/**
 * Watcher: najpierw oddaje listę od razu (bez czekania na indeks), potem tę samą
 * z uzupełnionymi autorami. Numer wydania pilnuje, żeby spóźnione uzupełnienie
 * starej migawki nie nadpisało nowszej.
 */
function emitThenFill<T>(
  items: T[],
  fill: (x: T[]) => Promise<T[]>,
  cb: (items: T[]) => void,
  gen: { n: number },
) {
  const mine = ++gen.n;
  cb(items);
  void fill(items)
    .then((filled) => {
      if (mine === gen.n && filled.some((f, i) => f !== items[i])) cb(filled);
    })
    .catch(() => {});
}

/** Komentarze needs_review (collectionGroup) — live. */
export function watchCommentsQueue(cb: (items: CommentItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(
    collectionGroup(db, "comments"),
    where("moderation.state", "in", WAITING_STATES),
    limit(QUEUE_LIMIT),
  );
  const gen = { n: 0 };
  return onSnapshot(
    q,
    (snap: QuerySnapshot) => {
      const out = snap.docs.map((d) =>
        mapComment(d.data(), d.id, d.ref.parent.parent?.id ?? ""),
      );
      out.sort(byOldest);
      emitThenFill(out, fillCommentAuthors, cb, gen);
    },
    onErr,
  );
}

/** Opisy needs_review (points) — live. */
export function watchDescriptionsQueue(cb: (items: DescriptionItem[]) => void, onErr: (e: unknown) => void) {
  const q = query(
    collection(db, "points"),
    where("moderation.state", "in", WAITING_STATES),
    limit(QUEUE_LIMIT),
  );
  const gen = { n: 0 };
  return onSnapshot(
    q,
    (snap) => {
      // Bez filtra pustego opisu: punkt z samymi zdjęciami też czeka na decyzję.
      const out = snap.docs.map((d) => mapDescription(d.data(), d.id));
      out.sort((a, b) => (queueDate(a) ?? Infinity) - (queueDate(b) ?? Infinity));
      emitThenFill(out, fillDescriptionAuthors, cb, gen);
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
      out.sort(byOldest);
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
  return fillCommentAuthors(out);
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
  // ⛔ NIE `byNewest` — to zdejmowało `orderBy("descriptionAddedAt","desc")` z
  // zapytania wyżej i przestawiało listę z powrotem na daty punktów.
  described.sort(byNewestDescription);
  const [newFilled, describedFilled] = await Promise.all([
    fillDescriptionAuthors(newPoints),
    fillDescriptionAuthors(described),
  ]);
  return {
    newPoints: newFilled,
    described: describedFilled,
    truncated: ugcSnap.size >= take || descSnap.size >= take,
  };
}

/**
 * Nazwy kont po uid (`users/{uid}.displayName`, read: isMod).
 *
 * Zgłoszenie niesie tylko `reporterUid`, więc bez tego kolumna „Autor" pokazuje
 * surowy identyfikator, który nic nie mówi. Brakujący dokument albo puste pole
 * zostaje pominięte — wiersz spadnie wtedy na „Użytkownik" jak w aplikacji.
 */
export async function fetchUserNames(uids: string[]): Promise<Map<string, string>> {
  const snaps = await Promise.all(
    uids.map((uid) => getDoc(doc(db, "users", uid)).catch(() => null)),
  );
  const out = new Map<string, string>();
  for (const s of snaps) {
    const name = s?.data()?.displayName;
    if (s && typeof name === "string" && name.trim() !== "") out.set(s.id, name);
  }
  return out;
}

/**
 * Punkty po ID — do WYŚWIETLENIA NAZWY przy komentarzu/zgłoszeniu, którego
 * rodzic nie zmieścił się w [fetchAllPoints]. Bez tego wiersz pokazuje gołe
 * `UGC:...` zamiast nazwy, którą user widzi w aplikacji. Brakujące dokumenty
 * (punkt usunięty) po prostu nie wracają.
 */
export async function fetchPointsByIds(ids: string[]): Promise<DescriptionItem[]> {
  const points = await Promise.all(ids.map((id) => fetchDescriptionById(id).catch(() => null)));
  return points.filter((p) => p !== null);
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
  // Bez filtra `targetType`: historia punktu to także edycje, usunięcia i przywrócenia.
  const clauses = [where("pointId", "==", pointId)];
  if (commentId) clauses.push(where("commentId", "==", commentId));
  const snap = await getDocs(query(collection(db, "moderationLog"), ...clauses, limit(200)));
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
    | "closeReport"
    | "closeReportsForTarget";
  pointId?: string;
  commentId?: string;
  reportId?: string;
  resolution?: "actioned" | "dismissed";
  /** Powód decyzji, trafia do moderationLog albo do zgłoszenia. */
  reason?: string;
  /** `closeReportsForTarget`: także zgłoszenia komentarzy tego punktu. */
  includeComments?: boolean;
  /** `closeReportsForTarget`: tylko zgłoszenia tego rodzaju (punkt, opis, komentarz). */
  target?: string;
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
export async function unblockUser(targetUid: string, reason?: string): Promise<void> {
  await setUserBlock(targetUid, false, reason);
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
  /** Numer kontaktowy; `null` czyści pole w dokumencie. */
  phone: string | null;
}>;

/** Zapisuje zmienione pola punktu (tylko podane wchodzą do update). */
export async function editPoint(
  pointId: string,
  fields: PointEditFields,
  reason?: string,
): Promise<string | null> {
  const fn = httpsCallable<unknown, { state: string | null }>(functions, "onModeratorEditPoint");
  return (await fn({ pointId, fields, reason })).data.state;
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
  /** Numer kontaktowy punktu (opcjonalny; walidacja po stronie callable). */
  phone?: string;
};

/** Kolizja z istniejącym punktem, którą zgłasza serwer przy dodawaniu. */
export type DuplicateHit = {
  id: string | null;
  name: string | null;
  dist_m: number;
  why: string;
};

/** Tworzy nowy punkt UGC. Zwraca nadane `UGC:<id>`. */
export async function createPoint(fields: PointCreateFields, force = false): Promise<string> {
  const fn = httpsCallable<{ fields: PointCreateFields; force: boolean }, { pointId: string }>(
    functions,
    "onModeratorCreatePoint",
  );
  const res = await fn({ fields, force });
  return res.data.pointId;
}

/**
 * Lista kolizji z błędu `already-exists`, null dla każdego innego błędu.
 * @param e błąd z callable
 */
export function duplicatesOf(e: unknown): DuplicateHit[] | null {
  const err = e as { code?: string; details?: { duplicates?: DuplicateHit[] } } | null;
  return err?.code === "functions/already-exists" ? err.details?.duplicates ?? [] : null;
}

/** Usunięcie punktu: UGC na stałe, punkt z bazy tombstone'em (odwracalne). */
export async function deletePoint(pointId: string, reason?: string): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorDeletePoint");
  await fn({ pointId, reason });
}

/** Zdejmuje tombstone. Serwer wymaga powodu min. 25 znaków. */
export async function restorePoint(pointId: string, powod: string): Promise<void> {
  const fn = httpsCallable(functions, "onModeratorRestorePoint");
  await fn({ pointId, powod });
}

// ── Szukanie punktów (callable) ──────────────────────────────────────────────
export type PointView = "all" | "suppressed" | "ugc" | "edited";

export type PointHit = {
  id: string;
  name: string | null;
  type: string | null;
  lat: number | null;
  lon: number | null;
  origin: PointOrigin;
  suppressed: boolean;
  hasDoc: boolean;
  state: ModState | null;
  status: string | null;
  phone: string | null;
  createdVia: string | null;
  distanceM?: number;
};

export type PointSearchInput = {
  q?: string;
  type?: string;
  view?: PointView;
  near?: { lat: number; lon: number };
  limit?: number;
};

/** Szuka w całej bazie: asset + dokumenty + usunięte. Czyta serwer, bo klient nie ma assetu. */
export async function searchPoints(
  input: PointSearchInput,
): Promise<{ hits: PointHit[]; total: number }> {
  const fn = httpsCallable<PointSearchInput, { hits: PointHit[]; total: number }>(
    functions,
    "moderatorSearchPoints",
  );
  return (await fn(input)).data;
}

// Odczyt bazy skleja wiersze z jednej chwili w jedno wywołanie, bo sto zgłoszeń to
// sto wierszy, a każde wywołanie to start funkcji z indeksem w pamięci.
const LOOKUP_BATCH = 200;
const baseCache = new Map<string, Promise<PointBase | null>>();
let lookupQueue: Array<{
  id: string;
  resolve: (b: PointBase | null) => void;
  reject: (e: unknown) => void;
}> = [];

async function flushLookups() {
  const batch = lookupQueue;
  lookupQueue = [];
  const fn = httpsCallable<{ ids: string[] }, { points: Record<string, PointBase> }>(
    functions,
    "moderatorLookupPoints",
  );
  for (let i = 0; i < batch.length; i += LOOKUP_BATCH) {
    const part = batch.slice(i, i + LOOKUP_BATCH);
    try {
      const { points } = (await fn({ ids: part.map((p) => p.id) })).data;
      for (const p of part) p.resolve(points[p.id] ?? null);
    } catch (e) {
      for (const p of part) {
        baseCache.delete(p.id);
        p.reject(e);
      }
    }
  }
}

/** Dane punktu z assetu. UGC nie ma tam wpisu. */
export function fetchPointBase(id: string): Promise<PointBase | null> {
  if (id.startsWith("UGC:")) return Promise.resolve(null);
  const hit = baseCache.get(id);
  if (hit) return hit;
  const promise = new Promise<PointBase | null>((resolve, reject) => {
    if (lookupQueue.length === 0) setTimeout(() => void flushLookups(), 0);
    lookupQueue.push({ id, resolve, reject });
  });
  baseCache.set(id, promise);
  return promise;
}

/** Czy punkt ma tombstone, czyli zniknął z mapy i da się go przywrócić. */
export async function fetchIsSuppressed(id: string): Promise<boolean> {
  return (await getDoc(doc(db, "suppressedPoints", id))).exists();
}

// ── Lista zablokowanych (moderationBlocks) ───────────────────────────────────
export type BlockedItem = {
  uid: string;
  /** uid moderatora albo `system` przy blokadzie automatycznej. */
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
  if (!snap.exists()) return null;
  const [filled] = await fillCommentAuthors([mapComment(snap.data(), snap.id, pointId)]);
  return filled;
}

/**
 * Punkt tak, jak widzi go apka: baza z assetu, na niej dokument. Nazwa i typ z
 * dokumentu tylko po poprawce moderatora, pozycja punktu z assetu zawsze z assetu
 * (lustro `applyVisibleOverride`). Null = punktu nie ma ani w bazie, ani w Firestore.
 */
export async function fetchDescriptionById(pointId: string): Promise<DescriptionItem | null> {
  const [snap, base] = await Promise.all([
    getDoc(doc(db, "points", pointId)),
    // Awaria indeksu nie może zabrać karty punktu, który ma dokument.
    fetchPointBase(pointId).catch(() => undefined),
  ]);
  if (base === undefined && !snap.exists()) throw new Error("nie udało się odczytać bazy punktów");
  if (!snap.exists() && !base) return null;
  const mapped = mapDescription(snap.exists() ? snap.data() : {}, pointId);
  if (!base) {
    const [filled] = await fillDescriptionAuthors([mapped]);
    return filled;
  }
  const edited = mapped.moderatorEdited;
  const point: DescriptionItem = {
    ...mapped,
    hasDoc: snap.exists(),
    inAsset: true,
    origin: edited ? "overlay" : "asset",
    name: edited && mapped.name ? mapped.name : base.name,
    type: edited && mapped.type ? mapped.type : base.type,
    lat: base.lat,
    lon: base.lon,
    base,
  };
  if (!snap.exists()) return point;
  const [filled] = await fillDescriptionAuthors([point]);
  return filled;
}

/** Komentarze punktu, każdy stan. Dla karty punktu. */
export async function fetchCommentsForPoint(pointId: string): Promise<CommentItem[]> {
  const snap = await getDocs(query(collection(db, "points", pointId, "comments"), limit(200)));
  const out = snap.docs.map((d) => mapComment(d.data(), d.id, pointId));
  out.sort(byNewest);
  return fillCommentAuthors(out);
}

/** Zgłoszenia punktu, otwarte i zamknięte. Dla karty punktu. */
export async function fetchReportsForPoint(pointId: string): Promise<ReportItem[]> {
  const snap = await getDocs(
    query(collection(db, "reports"), where("pointId", "==", pointId), limit(200)),
  );
  const out = snap.docs.map((d) => mapReport(d.data(), d.id));
  out.sort(byNewest);
  return out;
}

// ── Zdjęcia punktu (photos/{id}) — wątek zdjęć 0818 ──────────────────────────
// Dokumenty tworzy wyłącznie serwer apki (reservePhotoUpload); moderator może
// zdjąć KAŻDE zdjęcie callable'em photoModeratorDelete (wymóg sklepów dla
// treści użytkowników). Status `removed` zostaje jako ślad — wgląd bez plików.
export type PhotoItem = {
  id: string;
  pointId: string | null;
  authorUid: string;
  /** Jak [CommentItem.authorCleared]. */
  authorCleared: boolean;
  authorName: string;
  /** `pending` | `uploaded` | `visible` | `removed`. `uploaded` czeka na decyzję. */
  status: string;
  thumbUrl: string;
  fullUrl: string;
  createdAt: number | null;
  removedByModerator: boolean;
};

/** Obrona w głąb: adres idzie w `href`/`src`, więc wpuszczamy tylko https. */
function httpsOnly(v: unknown): string {
  return typeof v === "string" && v.startsWith("https://") ? v : "";
}

const PHOTO_STATUSES = new Set(["pending", "uploaded", "visible", "removed"]);

function mapPhoto(d: DocumentData, id: string): PhotoItem {
  return {
    id,
    pointId: typeof d.pointId === "string" ? d.pointId : null,
    authorUid: typeof d.authorUid === "string" ? d.authorUid : "",
    authorCleared: authorFieldCleared(d, "authorUid"),
    // Nazwa leci m.in. do okna potwierdzenia — znaki sterujące/nowe linie mogłyby
    // rozłamać treść dialogu, normalizujemy do pojedynczych spacji.
    authorName: typeof d.authorName === "string"
      ? d.authorName.replace(/\s+/g, " ").trim()
      : "",
    // Nieznany status → pending (ukryty) — śmieć z bazy nie ma się doliczać
    // do żadnej sekcji (apka analogicznie nie pokazuje nieznanych statusów).
    status: PHOTO_STATUSES.has(d.status) ? d.status : "pending",
    thumbUrl: httpsOnly(d.thumbUrl),
    fullUrl: httpsOnly(d.fullUrl),
    createdAt: millis(d.createdAt),
    removedByModerator: !!d.removedByModerator,
  };
}

/**
 * Zdjęcia punktu — WSZYSTKIE statusy (moderacja potrzebuje wglądu także w
 * usunięte). Jedno równościowe where = bez indeksu złożonego; zdjęć per punkt
 * jest z definicji garść (limit 5 visible + ślady).
 */
export async function fetchPhotosForPoint(pointId: string): Promise<PhotoItem[]> {
  const snap = await getDocs(
    query(collection(db, "photos"), where("pointId", "==", pointId), limit(50)),
  );
  const out = snap.docs.map((d) => mapPhoto(d.data(), d.id));
  out.sort(byNewest);
  return fillPhotoAuthors(out);
}

/** Zdejmuje zdjęcie ręką moderatora (photoModeratorDelete, status→removed). */
export async function moderatorDeletePhoto(photoId: string): Promise<void> {
  const fn = httpsCallable(functions, "photoModeratorDelete");
  await fn({ photoId });
}
