"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, EyeOff, Image as ImageIcon, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StateBadge } from "@/components/state-badge";
import { useBlocked } from "@/components/blocked-context";
import {
  Empty,
  KebabMenu,
  LabelChips,
  PublishHideButtons,
  QueueError,
  Section,
  TestBadge,
  blockActions,
  type KebabAction,
} from "@/components/common";
import { usePointCard } from "@/components/point-card-context";
import { PendingPhotos } from "@/components/point-photos";
import {
  descriptionContributor,
  descriptionDate,
  fetchCommentById,
  fetchDescriptionById,
  fetchPointBase,
  type CommentItem,
  type DescriptionItem,
  type PointBase,
  type ReportItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, fmtAge, fmtDate } from "@/lib/labels";
import { SHELTER_TYPE_LABEL } from "@/lib/taxonomy";
import { mapLink } from "@/lib/coords";
import {
  act,
  actDeletePoint,
  actDismissReports,
  actHide,
  closeTargetReports,
} from "@/lib/actions";

// Nazwa punktu zamiast samego id i wejście na kartę. Dotyczy też punktu bez dokumentu.
function PointLink({ pointId, name }: { pointId: string; name?: string }) {
  const { openCard } = usePointCard();
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (name) return;
    let alive = true;
    fetchDescriptionById(pointId)
      .then((p) => alive && setLoaded(p ? p.name || SHELTER_TYPE_LABEL[p.type] || "Punkt bez nazwy" : "Punkt usunięty"))
      .catch(() => alive && setLoaded("Nie udało się wczytać punktu"));
    return () => { alive = false; };
  }, [pointId, name]);
  return (
    <button
      type="button"
      className="break-words text-left font-medium underline-offset-2 hover:underline"
      title={pointId}
      onClick={() => openCard(pointId)}
    >
      {name || loaded || "Ładowanie…"}
    </button>
  );
}

export function QueueComments({ items, error, hideTest }: { items: CommentItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((c) => !c.isTest) : items;
  const { uids: blocked } = useBlocked();
  const { openCard } = usePointCard();
  return (
    <Section title="Komentarze do sprawdzenia" count={visible.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak komentarzy do sprawdzenia." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Autor / Punkt</TableHead>
              <TableHead>Treść</TableHead>
              <TableHead className="w-20">Zgłosz.</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-60 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c) => (
              <TableRow key={`${c.pointId}/${c.commentId}`}>
                <TableCell className="align-top text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="break-words">{c.authorName || "Użytkownik"}</span>
                    <PointLink pointId={c.pointId} />
                    {c.isTest && <TestBadge />}
                    <LabelChips labels={c.labels} />
                  </div>
                </TableCell>
                <TableCell className="align-top text-sm">
                  {c.text
                    ? <p className="whitespace-pre-wrap break-words">{c.text}</p>
                    : <p className="italic text-muted-foreground">[brak treści]</p>}
                </TableCell>
                <TableCell className="align-top">
                  {c.reportCount > 0 ? c.reportCount : "—"}
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PublishHideButtons
                      onPublish={() => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Opublikowano")}
                      onHide={() => actHide({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "komentarz", "Ukryto")}
                    />
                    <KebabMenu actions={[
                      { label: "Karta punktu", onClick: () => openCard(c.pointId) },
                      ...blockActions(c.authorUid, c.authorName, blocked),
                    ]} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

// Co się zmieniło względem bazy. Bez tego moderator zatwierdza nazwę i typ, nie
// widząc, że użytkownik właśnie je podmienił.
function BaseDiff({ p }: { p: DescriptionItem }) {
  const [base, setBase] = useState<PointBase | null>(null);
  useEffect(() => {
    let alive = true;
    fetchPointBase(p.pointId).then((b) => alive && setBase(b)).catch(() => {});
    return () => { alive = false; };
  }, [p.pointId]);
  const rows: string[] = [];
  if (base && p.name && p.name !== base.name) rows.push(`Nazwa w bazie: ${base.name}`);
  if (base && p.type && p.type !== base.type) {
    rows.push(`Kategoria w bazie: ${SHELTER_TYPE_LABEL[base.type] ?? base.type}`);
  }
  if (p.phonePending) rows.push(`Nowy telefon czeka: ${p.phonePending}`);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
      {rows.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

export function QueueDescriptions({ items, error, hideTest }: { items: DescriptionItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((p) => !p.isTest) : items;
  const { uids: blocked } = useBlocked();
  const { openCard, openEdit } = usePointCard();
  return (
    <Section title="Opisy i uzupełnienia do sprawdzenia" count={visible.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak opisów do sprawdzenia." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-52">Punkt</TableHead>
              <TableHead>Treść</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-60 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => {
              const autor = descriptionContributor(p);
              return (
                <TableRow key={p.pointId}>
                  <TableCell className="align-top text-sm">
                    <PointLink pointId={p.pointId} name={p.name || undefined} />
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <StateBadge state={p.state} />
                      {p.isTest && <TestBadge />}
                    </div>
                    <LabelChips labels={p.labels} />
                    {autor && <div className="mt-1 text-xs text-muted-foreground">{autor.name}</div>}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    {p.description
                      ? <p className="whitespace-pre-wrap break-words">{p.description}</p>
                      : <p className="italic text-muted-foreground">Bez opisu.</p>}
                    <BaseDiff p={p} />
                    <PendingPhotos pointId={p.pointId} />
                  </TableCell>
                  <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(descriptionDate(p) ?? p.createdAt)}</TableCell>
                  <TableCell className="align-top text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PublishHideButtons
                        onPublish={() => act({ action: "approveDescription", pointId: p.pointId }, "Opublikowano")}
                        onHide={() => actHide({ action: "rejectDescription", pointId: p.pointId }, "opis", "Ukryto")}
                      />
                      <KebabMenu
                        actions={[
                          { label: "Karta punktu", onClick: () => openCard(p.pointId) },
                          { label: "Edytuj punkt", onClick: () => openEdit(p.pointId) },
                          // Kolejka opisów moderuje OPIS, więc blokada celuje w jego
                          // autora (#615), nie w twórcę punktu. Przy nieznanej
                          // atrybucji `descriptionContributor` zwraca null / uid null
                          // — wtedy akcji NIE MA w ogóle, żeby nie zablokować
                          // niewinnego twórcy punktu za cudzy opis.
                          ...(() => {
                            if (!autor?.uid) return [];
                            // Doprecyzowanie „opisu" tylko wtedy, gdy w wierszu są DWIE
                            // osoby — inaczej etykieta sugerowałaby drugiego autora tam,
                            // gdzie jest jeden.
                            const label = autor.uid === p.authorUid ? undefined : `Zablokuj autora opisu (${autor.name})`;
                            return blockActions(autor.uid, autor.name, blocked, undefined, label);
                          })(),
                          {
                            label: "Usuń punkt",
                            variant: "destructive",
                            onClick: () => actDeletePoint(p.pointId, p.name),
                          },
                          ...(mapLink(p.lat, p.lon)
                            ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }]
                            : []),
                        ]}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

export type ReportGroup = {
  key: string;
  pointId: string;
  commentId: string | null;
  target: ReportItem["target"];
  reports: ReportItem[];
  oldest: number | null;
};

// Dedup zgłoszeń jest per zgłaszający, więc pięć osób to pięć dokumentów o jeden cel.
// Moderator podejmuje jedną decyzję, dlatego kolejka pokazuje jeden wiersz.
function groupReports(items: ReportItem[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  for (const r of items) {
    const key = `${r.pointId}/${r.commentId ?? ""}`;
    const g = groups.get(key);
    if (g) {
      g.reports.push(r);
      if (r.createdAt !== null && (g.oldest === null || r.createdAt < g.oldest)) g.oldest = r.createdAt;
    } else {
      groups.set(key, {
        key, pointId: r.pointId, commentId: r.commentId, target: r.target,
        reports: [r], oldest: r.createdAt,
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.oldest ?? Infinity) - (b.oldest ?? Infinity));
}

function reportReason(r: ReportItem): string {
  return r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";
}

export function QueueReports({ items, error, hideTest }: { items: ReportItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((r) => !r.isTest) : items;
  const groups = useMemo(() => groupReports(visible), [visible]);
  // Zegar z chwili wczytania listy, wystarczy dla wieku w dniach i godzinach.
  const [now] = useState(() => Date.now());
  return (
    <Section title="Zgłoszenia użytkowników" count={groups.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : groups.length === 0 ? (
        <Empty text="Brak otwartych zgłoszeń." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-56">Cel</TableHead>
              <TableHead>Co zgłoszono</TableHead>
              <TableHead className="w-20">Czeka</TableHead>
              <TableHead className="w-[30rem] text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => <ReportRow key={g.key} group={g} now={now} />)}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function ReportRow({ group, now }: { group: ReportGroup; now: number }) {
  // Wiersz startuje ZWINIĘTY — chevron rozwija sam PODGLĄD treści. Akcje są w linii
  // wiersza (kolumna Akcje), więc nie wymagają rozwijania.
  const [open, setOpen] = useState(false);
  // undefined = jeszcze nie pobrano (ładowanie), null = celu nie znaleziono, obiekt = cel.
  const [target, setTarget] = useState<CommentItem | DescriptionItem | null | undefined>(undefined);
  const isComment = group.target === "comment";
  const { pointId, commentId } = group;

  // Eager-load celu w TLE (mimo że wiersz zwinięty) — akcje w wierszu potrzebują
  // danych celu. setState w callbacku promisy — poza synchronicznym ciałem efektu.
  useEffect(() => {
    let alive = true;
    const p = isComment && commentId
      ? fetchCommentById(pointId, commentId)
      : fetchDescriptionById(pointId);
    p.then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null));
    return () => { alive = false; };
  }, [isComment, commentId, pointId]);

  const reasons = [...new Set(group.reports.map(reportReason))];
  const notes = group.reports.filter((r) => r.reason);

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            title="Podgląd zgłoszonej treści"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top text-sm">
          <PointLink pointId={pointId} />
          <div className="mt-0.5 text-xs text-muted-foreground">
            {TARGET_LABEL[group.target] ?? group.target}
            {group.reports.length > 1 && ` · ${group.reports.length} osoby`}
          </div>
        </TableCell>
        <TableCell className="align-top text-sm">
          <div className="flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span key={r} className="rounded border bg-muted px-1.5 py-0.5 text-xs">{r}</span>
            ))}
          </div>
          {notes.map((r) => (
            <p key={r.id} className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {r.reason}
            </p>
          ))}
        </TableCell>
        <TableCell className="align-top text-xs text-muted-foreground">{fmtAge(group.oldest, now)}</TableCell>
        <TableCell className="align-top">
          <ReportActions group={group} target={target} isComment={isComment} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="py-1">
              {target === undefined ? (
                <span className="text-xs text-muted-foreground">Ładowanie treści…</span>
              ) : target === null ? (
                <span className="text-sm text-muted-foreground">Zgłoszonej treści już nie ma albo nie udało się jej wczytać.</span>
              ) : (
                <ReportPreview target={target} isComment={isComment} />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Główna akcja wiersza wynika z tego, co zgłoszono. Reszta zostaje w zasięgu ręki.
const DELETE_FLAGS = new Set(["nie_istnieje", "zrujnowane"]);
const EDIT_FLAGS = new Set(["zla_kategoria", "zly_opis", "bledne_dane"]);

// Akcje zgłoszenia działają na doładowanym w tle `target` i domykają zgłoszenia
// wszystkich osób o ten cel. „Odrzuć zgłoszenie" działa zawsze, także bez celu.
function ReportActions({ group, target, isComment }: { group: ReportGroup; target: CommentItem | DescriptionItem | null | undefined; isComment: boolean }) {
  const { uids: blocked } = useBlocked();
  const { openCard, openEdit } = usePointCard();
  const { pointId, commentId } = group;
  const c = target && isComment ? (target as CommentItem) : null;
  const p = target && !isComment ? (target as DescriptionItem) : null;
  const hidden = target?.state === "rejected"; // ukryty w aplikacji
  const reportTarget = { pointId, commentId, target: group.target };
  const closeActioned = () => closeTargetReports(reportTarget, "actioned");
  const flags = group.reports.map((r) => r.flag);
  const deleteFirst = flags.some((f) => f && DELETE_FLAGS.has(f));
  const editFirst = !deleteFirst && flags.some((f) => f && EDIT_FLAGS.has(f));

  const kebab: KebabAction[] = [
    { label: "Karta punktu", onClick: () => openCard(pointId) },
    ...(c ? blockActions(c.authorUid, c.authorName, blocked) : []),
    ...(p && p.description
      ? [hidden
          ? {
              label: "Opublikuj opis",
              onClick: () => act({ action: "approveDescription", pointId }, "Opis opublikowany", closeActioned),
            }
          : {
              label: "Ukryj opis",
              onClick: () => actHide({ action: "rejectDescription", pointId }, "opis", "Opis ukryty", closeActioned),
            }]
      : []),
    ...(p && mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {c && (hidden ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2"
          onClick={() => act({ action: "approveComment", pointId, commentId: commentId! }, "Komentarz opublikowany", closeActioned)}
        >
          <Check className="h-3.5 w-3.5" />
          Opublikuj komentarz
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-red-600/40 px-2 text-red-700 hover:bg-red-600/10 dark:text-red-500"
          onClick={() => actHide({ action: "rejectComment", pointId, commentId: commentId! }, "komentarz", "Komentarz ukryty", closeActioned)}
        >
          <EyeOff className="h-3.5 w-3.5" />
          Ukryj komentarz
        </Button>
      ))}
      {p && (
        <>
          {flags.includes("kiepskie_zdjecia") && (
            <Button size="sm" className="h-7 gap-1 px-2" onClick={() => openCard(pointId)}>
              <ImageIcon className="h-3.5 w-3.5" />
              Zdjęcia punktu
            </Button>
          )}
          <Button
            size="sm"
            variant={editFirst ? "default" : "outline"}
            className="h-7 gap-1 px-2"
            onClick={() => openEdit(pointId, closeActioned)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edytuj punkt
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={deleteFirst
              ? "h-7 gap-1 border-red-600 bg-red-600 px-2 text-white hover:bg-red-700 hover:text-white"
              : "h-7 gap-1 border-red-600/40 px-2 text-red-700 hover:bg-red-600/10 dark:text-red-500"}
            onClick={() => actDeletePoint(pointId, p.name, () =>
              closeTargetReports({ pointId }, "actioned", { includeComments: true }))}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Usuń punkt
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        title="Zgłoszenie bez podstaw, treść zostaje bez zmian"
        onClick={() => actDismissReports(reportTarget)}
      >
        Odrzuć zgłoszenie
      </Button>
      {hidden && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          title="Treść jest już ukryta, np. z karty punktu"
          onClick={closeActioned}
        >
          Zamknij jako załatwione
        </Button>
      )}
      <KebabMenu actions={kebab} />
    </div>
  );
}

// Podgląd zgłoszonej treści (rozwijany chevronem) — sam tekst, bez akcji.
export function ReportPreview({ target, isComment }: { target: CommentItem | DescriptionItem; isComment: boolean }) {
  const c = isComment ? (target as CommentItem) : null;
  const p = !isComment ? (target as DescriptionItem) : null;
  return (
    <div className="min-w-0 text-sm">
      {c && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{c.authorName || "Użytkownik"}</span>
            <StateBadge state={c.state} />
          </div>
          <p className="whitespace-pre-wrap break-words">{c.text || "—"}</p>
        </>
      )}
      {p && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{p.name || p.pointId}</span>
            <StateBadge state={p.state} />
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">{p.description || "—"}</p>
        </>
      )}
    </div>
  );
}
