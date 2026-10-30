"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StateBadge, StatusBadge } from "@/components/state-badge";
import { useBlocked } from "@/components/blocked-context";
import {
  AuthorCell,
  Empty,
  FilterChips,
  KebabMenu,
  PointProps,
  Section,
  TestBadge,
  blockActions,
  type KebabAction,
} from "@/components/common";
import { HistoryPanel } from "@/components/history-panel";
import { usePointCard } from "@/components/point-card-context";
import { ReportPreview } from "@/components/queue";
import {
  BROWSE_LIMIT,
  descriptionContributor,
  descriptionDate,
  fetchAllComments,
  fetchAllReports,
  fetchCommentById,
  fetchContentPoints,
  fetchDescriptionById,
  fetchPointsByIds,
  fetchUserNames,
  type CommentItem,
  type DescriptionItem,
  type ReportItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, fmtDate } from "@/lib/labels";
import { mapLink } from "@/lib/coords";
import { SHELTER_TYPE_LABEL } from "@/lib/taxonomy";
import { act, actDeletePoint, actDismissReports, actHide, closeTargetReports } from "@/lib/actions";

// ── Wszystkie treści (scalone: nowe punkty / opisy / komentarze / zgłoszenia) ──

type ContentKind = "point" | "description" | "comment" | "report";
type ContentFilter = "all" | ContentKind;

const KIND_LABEL: Record<ContentKind, string> = {
  point: "Nowy punkt",
  description: "Opis",
  comment: "Komentarz",
  report: "Zgłoszenie",
};

// Kolor typu — rozróżnienie kategorii ma być widoczne w mieszanej liście
// („Wszystko") bez czytania etykiety.
const KIND_TONE: Record<ContentKind, string> = {
  point: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  description: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  comment: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  report: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
};

function KindBadge({ kind }: { kind: ContentKind }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${KIND_TONE[kind]}`}>
      {KIND_LABEL[kind]}
    </span>
  );
}

function ReportStatusBadge({ r }: { r: ReportItem }) {
  if (r.status === "open") {
    return <Badge className="border-transparent bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">Otwarte</Badge>;
  }
  const label = r.resolution === "dismissed" ? "Odrzucone" : "Załatwione";
  return <Badge className="border-transparent bg-muted font-normal text-muted-foreground">{label}</Badge>;
}

type ContentItem =
  | { kind: "point" | "description"; key: string; createdAt: number | null; isTest: boolean; p: DescriptionItem }
  | { kind: "comment"; key: string; createdAt: number | null; isTest: boolean; c: CommentItem }
  | { kind: "report"; key: string; createdAt: number | null; isTest: boolean; r: ReportItem };

const FILTER_ORDER: ContentFilter[] = ["all", "point", "description", "comment", "report"];
const FILTER_LABEL: Record<ContentFilter, string> = {
  all: "Wszystko",
  point: "Nowe punkty",
  description: "Opisy",
  comment: "Komentarze",
  report: "Zgłoszenia",
};

const PAGE_SIZE = 50;

export function ContentTab() {
  const [content, setContent] = useState<{
    newPoints: DescriptionItem[];
    described: DescriptionItem[];
    truncated: boolean;
  } | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  // Rodzice komentarzy/zgłoszeń spoza pobranej strony punktów — TYLKO do nazwy
  // w tytule wiersza, nigdy jako osobna pozycja listy.
  const [parents, setParents] = useState<DescriptionItem[]>([]);
  // uid → displayName; zgłoszenie niesie sam uid zgłaszającego, komentarz/opis
  // starego usera bywa bez `authorName`.
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  // Id, o które PYTALIŚMY przy dociągu rodziców. Brak w `parents` po odpytaniu
  // znaczy „punktu nie ma w bazie" (usunięty) — i tylko wtedy wolno tak napisać;
  // bez tego zbioru nie odróżnisz usuniętego od jeszcze-nie-pobranego.
  const [probedIds, setProbedIds] = useState<Set<string>>(new Set());
  const { uids: blocked } = useBlocked();
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(false);
  // Ile pobrać PER KOLEKCJA z serwera (rośnie „Załaduj więcej z serwera") vs
  // która strona po 50 pokazujemy z tego, co już mamy w pamięci (Poprzednia/
  // Następna) — dwa OSOBNE wymiary paginacji, nie mylić.
  const [fetchTake, setFetchTake] = useState(BROWSE_LIMIT);
  const [page, setPage] = useState(0);

  const load = useCallback((take: number) => {
    fetchContentPoints(take).then(setContent).catch(() => toast.error("Błąd punktów i opisów."));
    fetchAllComments(take).then(setComments).catch(() => toast.error("Błąd komentarzy."));
    fetchAllReports(take).then(setReports).catch(() => toast.error("Błąd zgłoszeń."));
  }, []);
  useEffect(() => { load(fetchTake); }, [load, fetchTake]);
  // Dociąg rodziców, których nie ma w pobranej stronie punktów — inaczej wiersz
  // komentarza/zgłoszenia pokazuje gołe id zamiast nazwy widocznej w aplikacji.
  useEffect(() => {
    if (!content || !comments || !reports) return;
    const have = new Set([...content.newPoints, ...content.described].map((p) => p.pointId));
    const missing = [...new Set([
      ...comments.map((c) => c.pointId),
      ...reports.map((r) => r.pointId),
    ])].filter((id) => id && !have.has(id));
    if (missing.length === 0) return;
    let alive = true;
    // Limit strażniczy: przy dużej kolejce nie robimy setek odczytów naraz.
    const asked = missing.slice(0, 200);
    fetchPointsByIds(asked)
      .then((ps) => {
        if (!alive) return;
        setParents(ps);
        setProbedIds(new Set(asked));
      })
      .catch(() => {/* tytuł spadnie na id — nie warto krzyczeć */});
    return () => { alive = false; };
  }, [content, comments, reports]);

  // Nazwy kont — dla zgłaszających (zgłoszenie ma sam uid) i dla treści bez
  // zapisanego `authorName`. Osobny efekt, bo lista uid zmienia się inaczej
  // niż lista punktów-rodziców.
  useEffect(() => {
    if (!content || !comments || !reports) return;
    const uids = new Set<string>();
    for (const r of reports) if (r.reporterUid) uids.add(r.reporterUid);
    for (const c of comments) if (c.authorUid && !c.authorName) uids.add(c.authorUid);
    for (const p of [...content.newPoints, ...content.described]) {
      if (p.authorUid && !p.authorName) uids.add(p.authorUid);
    }
    if (uids.size === 0) return;
    let alive = true;
    fetchUserNames([...uids].slice(0, 200))
      .then((m) => alive && setUserNames(m))
      .catch(() => {/* zostaje uid — nie warto krzyczeć */});
    return () => { alive = false; };
  }, [content, comments, reports]);

  if (!content || !comments || !reports) return <Empty text="Ładowanie…" />;

  // Rodzic dociągnięty wcześniej może w międzyczasie wejść do listy (np. po
  // „Załaduj więcej") — wtedy odpada, bo rekord z listy jest świeższy. Odsiew
  // przy budowie mapy, nie czyszczeniem stanu: `setState` w efekcie kaskaduje
  // render (react-hooks/set-state-in-effect), a tu wystarczy czysty filtr.
  const contentIds = new Set(
    [...content.newPoints, ...content.described].map((p) => p.pointId),
  );
  const pointById = new Map(
    [
      ...parents.filter((p) => !contentIds.has(p.pointId)),
      ...content.described,
      ...content.newPoints,
    ].map((p) => [p.pointId, p]),
  );

  const items: ContentItem[] = [
    ...content.newPoints.map((p): ContentItem => (
      { kind: "point", key: `point/${p.pointId}`, createdAt: p.createdAt, isTest: p.isTest, p })),
    // Wiersz opisu niesie datę OPISU — i jako wyświetlaną, i jako klucz sortu
    // niżej. `p.createdAt` (data punktu) kłamał w obu rolach — patrz
    // [descriptionDate].
    ...content.described.map((p): ContentItem => (
      { kind: "description", key: `desc/${p.pointId}`, createdAt: descriptionDate(p), isTest: p.isTest, p })),
    ...comments.map((c): ContentItem => (
      { kind: "comment", key: `comment/${c.pointId}/${c.commentId}`, createdAt: c.createdAt, isTest: c.isTest, c })),
    ...reports.map((r): ContentItem => (
      { kind: "report", key: `report/${r.id}`, createdAt: r.createdAt, isTest: r.isTest, r })),
  ].sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity));

  const needle = search.trim().toLowerCase();
  const haystack = (it: ContentItem): string => {
    switch (it.kind) {
      case "point":
      case "description":
        return `${it.p.name} ${it.p.pointId} ${it.p.authorName} ${it.p.description}`;
      case "comment":
        return `${pointById.get(it.c.pointId)?.name ?? ""} ${it.c.pointId} ${it.c.authorName} ${it.c.text}`;
      case "report":
        return `${pointById.get(it.r.pointId)?.name ?? ""} ${it.r.pointId} ${it.r.reason ?? ""}`;
    }
  };
  const visible = items
    .filter((it) => filter === "all" || it.kind === filter)
    .filter((it) => !hideTest || !it.isTest)
    .filter((it) => needle === "" || haystack(it).toLowerCase().includes(needle));

  const counts: Record<ContentFilter, number> = {
    all: items.length,
    point: items.filter((i) => i.kind === "point").length,
    description: items.filter((i) => i.kind === "description").length,
    comment: items.filter((i) => i.kind === "comment").length,
    report: items.filter((i) => i.kind === "report").length,
  };
  const truncated =
    content.truncated || comments.length >= fetchTake || reports.length >= fetchTake;
  const reload = () => load(fetchTake);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = visible.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Każda zmiana zawężenia wraca na 1. stronę — inaczej można wylądować
            na stronie, której po filtrze już nie ma. */}
        <FilterChips<ContentFilter>
          value={filter}
          onChange={(v) => { setFilter(v); setPage(0); }}
          options={FILTER_ORDER.map((v) => ({
            value: v,
            label: `${FILTER_LABEL[v]} (${counts[v]})`,
          }))}
        />
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-foreground"
              checked={hideTest}
              onChange={(e) => { setHideTest(e.target.checked); setPage(0); }}
            />
            Ukryj testowe
          </label>
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Szukaj: punkt, autor, treść…"
            className="h-8 w-64"
          />
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={reload} title="Odśwież listę">
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Section title="Wszystkie treści" count={visible.length}>
        {visible.length === 0 ? (
          <Empty text="Nic tu nie ma. Zmień filtr albo wyszukiwanie." />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-28">Typ</TableHead>
                <TableHead className="w-36">Autor</TableHead>
                <TableHead>Treść</TableHead>
                <TableHead className="w-32">Stan</TableHead>
                <TableHead className="w-32">Data</TableHead>
                <TableHead className="w-12 text-right">Akcje</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((it) => (
                <ContentRow
                  key={it.key}
                  item={it}
                  pointById={pointById}
                  probedIds={probedIds}
                  userNames={userNames}
                  blocked={blocked}
                  reload={reload}
                />
              ))}
            </TableBody>
          </Table>
        )}
        {visible.length > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              {clampedPage * PAGE_SIZE + 1}–{Math.min(visible.length, clampedPage * PAGE_SIZE + PAGE_SIZE)} z {visible.length}
            </span>
            <div className="flex items-center gap-2">
              {/* Kroki liczone od clampedPage, NIE od surowego `page` — po
                  skasowaniu treści lista się kurczy i `page` zostaje poza
                  zakresem; krok od `page` wyglądałby wtedy jak zacięty przycisk. */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={clampedPage === 0}
                onClick={() => setPage(Math.max(0, clampedPage - 1))}
              >
                Poprzednia
              </Button>
              <span>{clampedPage + 1} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setPage(Math.min(totalPages - 1, clampedPage + 1))}
              >
                Następna
              </Button>
            </div>
          </div>
        )}
        {truncated && (
          <div className="flex items-center justify-between gap-3 border-t bg-amber-50 px-4 py-2 text-xs text-amber-700">
            <span>⚠ Pobrano pierwsze {fetchTake} z każdej listy (punkty/opisy, komentarze, zgłoszenia), więc może być więcej na serwerze.</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 border-amber-400 bg-transparent px-2 text-amber-800 hover:bg-amber-100"
              onClick={() => setFetchTake((t) => t + BROWSE_LIMIT)}
            >
              Załaduj więcej z serwera
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}

function ContentRow({
  item,
  pointById,
  probedIds,
  userNames,
  blocked,
  reload,
}: {
  item: ContentItem;
  pointById: Map<string, DescriptionItem>;
  probedIds: Set<string>;
  userNames: Map<string, string>;
  blocked: Set<string>;
  reload: () => void;
}) {
  const { openCard, openEdit } = usePointCard();
  const [open, setOpen] = useState(false);
  // Cel zgłoszenia — doładowywany w TLE tylko dla OTWARTYCH zgłoszeń (akcje na
  // celu). Zamknięte zgłoszenie jest zapisem historycznym, bez akcji.
  const isOpenReport = item.kind === "report" && item.r.status === "open";
  const [target, setTarget] = useState<CommentItem | DescriptionItem | null | undefined>(undefined);
  const reportPointId = item.kind === "report" ? item.r.pointId : "";
  const reportCommentId = item.kind === "report" ? item.r.commentId : null;
  useEffect(() => {
    if (!isOpenReport) return;
    let alive = true;
    const p = reportCommentId
      ? fetchCommentById(reportPointId, reportCommentId)
      : fetchDescriptionById(reportPointId);
    p.then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null));
    return () => { alive = false; };
  }, [isOpenReport, reportPointId, reportCommentId]);

  let author: React.ReactNode;
  let content: React.ReactNode;
  let state: React.ReactNode;
  let kebab: KebabAction[] = [];
  let historyPointId = "";
  let historyCommentId: string | null = null;

  // Lustro apki (`shelter.dart`: `name ?? type.labelPl`) — brak nazwy pokazuje
  // etykietę TYPU, nie gołe id. Surowe id zostaje jako OSTATECZNY fallback,
  // gdy nawet typu nie znamy (np. cel usunięty).
  // Nazwa punktu → etykieta TYPU, gdy nazwy brak (lustro apki: shelter.dart
  // `name ?? type.labelPl`) → „Punkt usunięty", gdy odpytaliśmy bazę i punktu
  // nie ma. Gołe id nie trafia do kolumny — dla człowieka nic nie znaczy;
  // zostaje w tooltipie [PointTitle].
  const titleOf = (pointId: string): string => {
    const pd = pointById.get(pointId);
    if (pd) return pd.name || SHELTER_TYPE_LABEL[pd.type] || "Punkt bez nazwy";
    return probedIds.has(pointId) ? "Punkt usunięty" : "Ładowanie…";
  };
  // Nazwa konta: zapisana przy treści → dociągnięta z `users` → jak w apce.
  const nameOf = (authorName: string, uid: string) =>
    authorName || userNames.get(uid) || "Użytkownik";

  switch (item.kind) {
    case "point":
    case "description": {
      const p = item.p;
      const isPanelPoint = p.createdVia === "moderation-panel";
      // Autor DOKUMENTU (twórca punktu) i autor OPISU to dwie różne osoby, gdy
      // opis dopisano do cudzego punktu — #615 rozdzielił je w apce, panel musi
      // to lustrzyć. Pokazujemy oba tylko wtedy, gdy się różnią.
      const opisAutor = p.description ? descriptionContributor(p) : null;
      const opisInny = !!opisAutor && opisAutor.uid !== p.authorUid;
      // ⛔ W wierszu `description` pierwszoplanowy jest autor OPISU, bo to jego
      // treść moderujemy. Odwrotna kolejność podpisywała cudzy opis twórcą
      // punktu — przy punktach z panelu wychodziło „Zespół Hyc!" pogrubione nad
      // opisem, którego zespół nie napisał (zgłoszenie usera 0818). Wiersz
      // `point` zostaje bez zmian: tam bohaterem jest właśnie twórca punktu.
      const opisNaCzele = item.kind === "description" && opisInny;
      author = (
        <div className="flex flex-col gap-1">
          {opisNaCzele ? (
            <>
              <AuthorCell
                name={opisAutor.name}
                uid={opisAutor.uid ?? ""}
                blocked={!!opisAutor.uid && blocked.has(opisAutor.uid)}
              />
              <span className="text-xs text-muted-foreground" title={p.authorUid || undefined}>
                punkt: {nameOf(p.authorName, p.authorUid)}
              </span>
            </>
          ) : (
            <AuthorCell name={nameOf(p.authorName, p.authorUid)} uid={p.authorUid} blocked={blocked.has(p.authorUid)} />
          )}
          {opisInny && !opisNaCzele && (
            <span className="text-xs text-muted-foreground" title={opisAutor.uid ?? undefined}>
              opis: {opisAutor.name}
            </span>
          )}
          {/* Opis bez atrybucji: dokument legacy, w którym opis dopisano
              PÓŹNIEJ niż powstał punkt — tożsamości autora nie da się już
              odzyskać. Milczymy zamiast przypisać go twórcy punktu. */}
          {p.description && !opisAutor && (
            <span className="text-xs italic text-muted-foreground">opis: autor nieznany</span>
          )}
        </div>
      );
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={p.pointId}>{titleOf(p.pointId)}</span>
          <PointProps p={p} />
          {p.description ? (
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{p.description}</p>
          ) : (
            <span className="text-xs italic text-muted-foreground">bez opisu</span>
          )}
        </div>
      );
      state = <StateBadge state={p.state} />;
      // Publikuj/Ukryj opis USUNIĘTE z tego widoku (decyzja usera 0812) —
      // korekta treści idzie przez „Edytuj punkt" zamiast osobnego stanu
      // widoczności. Kolejka (needs_review) zostaje z własnym Publikuj/Ukryj —
      // to inny przepływ (moderacja pre-publikacji), nietknięty.
      kebab = [
        { label: "Karta punktu", onClick: () => openCard(p.pointId) },
        { label: "Edytuj punkt", onClick: () => openEdit(p.pointId, reload) },
        ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
        ...(isPanelPoint ? [] : blockActions(p.authorUid, p.authorName, blocked, undefined,
          opisInny ? "Zablokuj autora punktu" : undefined)),
        // ⛔ Osobna pozycja, gdy opis jest CUDZY: bez niej „Zablokuj autora"
        // przy wierszu z obraźliwym opisem trafiałoby w twórcę punktu, czyli
        // w niewinną osobę. Blokujemy tego, kto napisał treść.
        ...(opisInny && opisAutor.uid
          ? blockActions(opisAutor.uid, opisAutor.name, blocked, undefined, "Zablokuj autora opisu")
          : []),
        { label: "Usuń punkt", variant: "destructive", onClick: () => actDeletePoint(p.pointId, p.name, reload) },
      ];
      historyPointId = p.pointId;
      break;
    }
    case "comment": {
      const c = item.c;
      const parent = pointById.get(c.pointId);
      author = <AuthorCell name={nameOf(c.authorName, c.authorUid)} uid={c.authorUid} blocked={blocked.has(c.authorUid)} />;
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={c.pointId}>{titleOf(c.pointId)}</span>
          {c.text
            ? <p className="line-clamp-3 whitespace-pre-wrap break-words">{c.text}</p>
            : <span className="text-xs italic text-muted-foreground">[brak treści]</span>}
        </div>
      );
      state = (
        <div className="flex flex-col items-start gap-1">
          <StateBadge state={c.state} />
          {c.status !== "active" && <StatusBadge status={c.status} />}
        </div>
      );
      kebab = [
        { label: "Karta punktu", onClick: () => openCard(c.pointId) },
        ...(c.state !== "approved"
          ? [{ label: "Opublikuj komentarz", onClick: () => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Opublikowano", reload) }]
          : []),
        ...(c.status !== "removed"
          ? [{
              label: "Ukryj komentarz",
              onClick: () => actHide({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "komentarz", "Ukryto", reload),
            }]
          : []),
        ...(parent && mapLink(parent.lat, parent.lon) ? [{ label: "Pokaż na mapie", href: mapLink(parent.lat, parent.lon)! }] : []),
        ...blockActions(c.authorUid, c.authorName, blocked),
      ];
      historyPointId = c.pointId;
      historyCommentId = c.commentId;
      break;
    }
    case "report": {
      const r = item.r;
      const reason = r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";
      // ⛔ W wierszu zgłoszenia kolumna „Autor" pokazuje ZGŁASZAJĄCEGO, a akcje
      // w kebabie działają na autorze ZGŁOSZONEJ TREŚCI — to dwie różne osoby.
      // Bez tego podpisu moderator czyta nazwisko z kolumny i klika „Zablokuj
      // autora" przekonany, że blokuje właśnie ją.
      // Blokada zgłaszającego świadomie NIEDOSTĘPNA (zgłaszanie to nie treść).
      author = r.reporterUid
        ? <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">zgłosił</span>
            <AuthorCell
              name={nameOf("", r.reporterUid)}
              uid={r.reporterUid}
              blocked={blocked.has(r.reporterUid)}
            />
          </div>
        : <span className="text-muted-foreground">—</span>;
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={r.pointId}>
            {titleOf(r.pointId)}
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              {TARGET_LABEL[r.target] ?? r.target} · {reason}
            </span>
          </span>
          {r.reason
            ? <p className="line-clamp-3 whitespace-pre-wrap break-words">{r.reason}</p>
            : <span className="text-xs italic text-muted-foreground">bez uzasadnienia</span>}
        </div>
      );
      state = <ReportStatusBadge r={r} />;
      if (isOpenReport) {
        const reportTarget = { pointId: r.pointId, commentId: r.commentId, target: r.target };
        const closeActioned = () => closeTargetReports(reportTarget, "actioned", {}, reload);
        const c = target && r.target === "comment" ? (target as CommentItem) : null;
        const p = target && r.target !== "comment" ? (target as DescriptionItem) : null;
        const hidden = target?.state === "rejected";
        kebab = [
          { label: "Karta punktu", onClick: () => openCard(r.pointId) },
          ...(c
            ? [
                hidden
                  ? { label: "Opublikuj komentarz", onClick: () => act({ action: "approveComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz opublikowany", closeActioned) }
                  : {
                      label: "Ukryj komentarz",
                      onClick: () => actHide({ action: "rejectComment", pointId: r.pointId, commentId: r.commentId! }, "komentarz", "Komentarz ukryty", closeActioned),
                    },
                // Etykieta mówi KOGO, bo kolumna „Autor" pokazuje tu zgłaszającego.
                ...blockActions(c.authorUid, c.authorName, blocked, undefined, "Zablokuj autora komentarza"),
              ]
            : []),
          ...(p
            ? [
                // Opublikuj/Ukryj opis usunięte tu też — edycja punktu zamyka
                // zgłoszenie przez onSaved, więc alternatywna droga zostaje.
                { label: "Edytuj punkt", onClick: () => openEdit(r.pointId, closeActioned) },
                ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
                // Parytet z wierszem opisu: autora da się zablokować także z
                // poziomu zgłoszenia (chyba że to wpis panelu). ⛔ Zgłoszenie
                // o celu `description` dotyczy OPISU, więc blokada musi trafić
                // w jego autora — przy cudzym opisie twórca punktu jest tu
                // osobą postronną.
                ...(p.createdVia === "moderation-panel"
                  ? []
                  : (() => {
                      const a = r.target === "description" && p.description
                        ? descriptionContributor(p)
                        : null;
                      const inny = !!a && a.uid !== p.authorUid;
                      return inny && a.uid
                        ? blockActions(a.uid, a.name, blocked, undefined, "Zablokuj autora opisu")
                        : blockActions(p.authorUid, p.authorName, blocked, undefined, "Zablokuj autora punktu");
                    })()),
                { label: "Usuń punkt", variant: "destructive" as const, onClick: () => actDeletePoint(r.pointId, p.name ?? "", () => closeTargetReports({ pointId: r.pointId }, "actioned", { includeComments: true }, reload)) },
              ]
            : []),
          { label: "Odrzuć zgłoszenie", onClick: () => actDismissReports(reportTarget, reload) },
        ];
      } else {
        const parent = pointById.get(r.pointId);
        kebab = [
          { label: "Karta punktu", onClick: () => openCard(r.pointId) },
          ...(parent && mapLink(parent.lat, parent.lon) ? [{ label: "Pokaż na mapie", href: mapLink(parent.lat, parent.lon)! }] : []),
        ];
      }
      historyPointId = r.pointId;
      historyCommentId = r.commentId;
      break;
    }
  }

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            title={item.kind === "report" ? "Zgłoszona treść i historia decyzji" : "Historia decyzji"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col items-start gap-1">
            <KindBadge kind={item.kind} />
            {item.isTest && <TestBadge />}
          </div>
        </TableCell>
        <TableCell className="align-top text-sm">{author}</TableCell>
        <TableCell className="align-top text-sm">{content}</TableCell>
        <TableCell className="align-top">{state}</TableCell>
        <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(item.createdAt)}</TableCell>
        <TableCell className="align-top text-right">
          <KebabMenu actions={kebab} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30">
            <div className="space-y-3 py-1">
              {item.kind === "report" && (
                target === undefined && isOpenReport ? (
                  <span className="text-xs text-muted-foreground">Ładowanie zgłoszonej treści…</span>
                ) : target ? (
                  <ReportPreview target={target} isComment={item.r.target === "comment"} />
                ) : (
                  <span className="text-xs text-muted-foreground">Zgłoszona treść niedostępna (usunięta albo zgłoszenie zamknięte).</span>
                )
              )}
              <HistoryPanel pointId={historyPointId} commentId={historyCommentId} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
