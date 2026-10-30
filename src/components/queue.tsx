"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, EyeOff, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  PointProps,
  PublishHideButtons,
  QueueError,
  Section,
  TestBadge,
  blockActions,
  type KebabAction,
} from "@/components/common";
import { PointEditDialog } from "@/components/point-forms";
import { PointPhotos } from "@/components/point-photos";
import {
  descriptionContributor,
  descriptionDate,
  fetchCommentById,
  fetchDescriptionById,
  type CommentItem,
  type DescriptionItem,
  type ReportItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, fmtDate } from "@/lib/labels";
import { mapLink } from "@/lib/coords";
import { act, actDeletePoint, confirmHide } from "@/lib/actions";

export function QueueComments({ items, error, hideTest }: { items: CommentItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((c) => !c.isTest) : items;
  const { uids: blocked } = useBlocked();
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
              <TableHead className="w-40">Autor / Punkt</TableHead>
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
                    <span className="font-mono text-[10px] text-muted-foreground">{c.pointId}</span>
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
                  {c.reportCount > 0 ? <Badge variant="destructive">{c.reportCount}</Badge> : "—"}
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PublishHideButtons
                      onPublish={() => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Opublikowano")}
                      onHide={() =>
                        confirmHide("komentarz") &&
                        act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Ukryto")
                      }
                    />
                    <KebabMenu actions={blockActions(c.authorUid, c.authorName, blocked)} />
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

export function QueueDescriptions({ items, error, hideTest }: { items: DescriptionItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((p) => !p.isTest) : items;
  const [editingId, setEditingId] = useState<string | null>(null);
  const { uids: blocked } = useBlocked();
  return (
    <Section title="Opisy do sprawdzenia" count={visible.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak opisów do sprawdzenia." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Punkt</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-60 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p.pointId}>
                <TableCell className="align-top text-sm font-medium">
                  <span className="break-words">{p.name || p.pointId}</span>
                  <PointProps p={p} />
                  <LabelChips labels={p.labels} />
                  {p.isTest && <div className="mt-1"><TestBadge /></div>}
                </TableCell>
                <TableCell className="align-top text-sm">
                  <p className="whitespace-pre-wrap break-words">{p.description}</p>
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(descriptionDate(p))}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PublishHideButtons
                      onPublish={() => act({ action: "approveDescription", pointId: p.pointId }, "Opublikowano")}
                      onHide={() =>
                        confirmHide("opis") && act({ action: "rejectDescription", pointId: p.pointId }, "Ukryto")
                      }
                    />
                    <KebabMenu
                      actions={[
                        {
                          label: "Edytuj punkt",
                          onClick: () => setEditingId(p.pointId),
                        },
                        // Kolejka opisów moderuje OPIS, więc blokada celuje w jego
                        // autora (#615), nie w twórcę punktu. Przy nieznanej
                        // atrybucji `descriptionContributor` zwraca null / uid null
                        // — wtedy akcji NIE MA w ogóle, żeby nie zablokować
                        // niewinnego twórcy punktu za cudzy opis.
                        ...(() => {
                          const a = descriptionContributor(p);
                          if (!a?.uid) return [];
                          // Doprecyzowanie „opisu" tylko wtedy, gdy w wierszu są DWIE
                          // osoby — inaczej etykieta sugerowałaby drugiego autora tam,
                          // gdzie jest jeden.
                          const label = a.uid === p.authorUid ? undefined : `Zablokuj autora opisu (${a.name})`;
                          return blockActions(a.uid, a.name, blocked, undefined, label);
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
            ))}
          </TableBody>
        </Table>
      )}
      <PointEditDialog
        point={visible.find((p) => p.pointId === editingId) ?? null}
        onClose={() => setEditingId(null)}
      />
    </Section>
  );
}

export function QueueReports({ items, error, hideTest }: { items: ReportItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((r) => !r.isTest) : items;
  return (
    <Section title="Zgłoszenia użytkowników" count={visible.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak otwartych zgłoszeń." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-24">Cel</TableHead>
              <TableHead className="w-40">Przyczyna</TableHead>
              <TableHead>Powód (tekst)</TableHead>
              <TableHead className="w-96 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

// Odrzucenie zgłoszenia jako niezasadne (treść zostaje bez zmian). Wydzielone,
// bo używane i przy istniejącym celu, i gdy cel skasowany (report i tak da się domknąć).
function dismissReport(r: ReportItem) {
  act({ action: "closeReport", reportId: r.id, resolution: "dismissed" }, "Zgłoszenie odrzucone (niezasadne)");
}

// Wiersz zgłoszenia z rozwijanym PODGLĄDEM zgłoszonej treści (resolve celu po id)
// + akcjami NA CEL (zatwierdź/odrzuć), obok zamknięcia samego zgłoszenia.
function ReportRow({ r }: { r: ReportItem }) {
  // Wiersz startuje ZWINIĘTY — chevron rozwija sam PODGLĄD treści. Akcje są w linii
  // wiersza (kolumna Akcje), więc nie wymagają rozwijania.
  const [open, setOpen] = useState(false);
  // undefined = jeszcze nie pobrano (ładowanie), null = celu nie znaleziono, obiekt = cel.
  const [target, setTarget] = useState<CommentItem | DescriptionItem | null | undefined>(undefined);
  const isComment = r.target === "comment";
  const reason = r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";

  // Eager-load celu w TLE (mimo że wiersz zwinięty) — akcje w wierszu potrzebują
  // danych celu. setState w callbacku promisy — poza synchronicznym ciałem efektu.
  useEffect(() => {
    let alive = true;
    const p = isComment && r.commentId
      ? fetchCommentById(r.pointId, r.commentId)
      : fetchDescriptionById(r.pointId);
    p.then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null));
    return () => {
      alive = false;
    };
  }, [isComment, r.commentId, r.pointId]);

  // Cel jest już w stanie — chevron tylko pokazuje/chowa, bez ponownego fetcha.
  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={toggle}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            title="Podgląd zgłoszonej treści"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col gap-1">
            <Badge variant="outline">{TARGET_LABEL[r.target] ?? r.target}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground break-all">
              {r.pointId}
              {r.commentId ? `/${r.commentId}` : ""}
            </span>
          </div>
        </TableCell>
        <TableCell className="align-top text-sm">{reason}</TableCell>
        <TableCell className="align-top text-sm text-muted-foreground">
          <p className="whitespace-pre-wrap break-words">{r.reason || "—"}</p>
        </TableCell>
        <TableCell className="align-top">
          <ReportActions r={r} target={target} isComment={isComment} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="py-1">
              {target === undefined ? (
                <span className="text-xs text-muted-foreground">Ładowanie treści…</span>
              ) : target === null ? (
                <span className="text-sm text-muted-foreground">—</span>
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

// Akcje zgłoszenia — renderowane W LINII wiersza (kolumna Akcje), nie w rozwinięciu.
// Działają na doładowanym w tle `target`. Główne akcje widoczne, reszta pod kebabem,
// zestaw zależny od typu celu. Każda akcja na treści AUTO-ZAMYKA zgłoszenie (actioned);
// „Odrzuć zgłoszenie" (dismissed) działa zawsze, także zanim cel się doładuje.
function ReportActions({ r, target, isComment }: { r: ReportItem; target: CommentItem | DescriptionItem | null | undefined; isComment: boolean }) {
  const [editing, setEditing] = useState(false);
  const { uids: blocked } = useBlocked();
  const c = target && isComment ? (target as CommentItem) : null;
  const p = target && !isComment ? (target as DescriptionItem) : null;
  const hidden = target?.state === "rejected"; // ukryty w aplikacji

  // Po skutecznej akcji na treści zamykamy też zgłoszenie — znika z kolejki.
  const closeActioned = () =>
    act({ action: "closeReport", reportId: r.id, resolution: "actioned" }, "Zgłoszenie zamknięte");

  // Kebab = akcje drugorzędne, zależne od typu celu (pusty, gdy cel się nie doładował).
  const kebab: KebabAction[] = c
    ? blockActions(c.authorUid, c.authorName, blocked)
    : p
      ? [
          {
            label: "Usuń punkt",
            variant: "destructive",
            onClick: () => actDeletePoint(r.pointId, p.name ?? "", closeActioned),
          },
          hidden
            ? {
                label: "Opublikuj opis",
                onClick: () => act({ action: "approveDescription", pointId: r.pointId }, "Opis opublikowany", closeActioned),
              }
            : {
                label: "Ukryj opis",
                onClick: () => {
                  if (confirmHide("opis")) act({ action: "rejectDescription", pointId: r.pointId }, "Opis ukryty", closeActioned);
                },
              },
          ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
        ]
      : [];

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {c ? (
        hidden ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
            onClick={() =>
              act({ action: "approveComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz opublikowany", closeActioned)
            }
          >
            <Check className="h-3.5 w-3.5" />
            Opublikuj komentarz
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
            onClick={() => {
              if (window.confirm("Usunąć komentarz? Zniknie z aplikacji (można przywrócić przez „Opublikuj komentarz”)."))
                act({ action: "rejectComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz usunięty", closeActioned);
            }}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Usuń komentarz
          </Button>
        )
      ) : p ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edytuj punkt
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        title="Zgłoszenie bez podstaw — treść zostaje bez zmian"
        onClick={() => dismissReport(r)}
      >
        Odrzuć zgłoszenie
      </Button>
      <KebabMenu actions={kebab} />
      {p && <PointEditDialog point={editing ? p : null} onClose={() => setEditing(false)} onSaved={closeActioned} />}
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
          <PointProps p={p} />
          <p className="mt-1 whitespace-pre-wrap break-words">{p.description || "—"}</p>
          <PointPhotos pointId={p.pointId} />
        </>
      )}
    </div>
  );
}
