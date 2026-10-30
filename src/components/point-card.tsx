"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ExternalLink, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StateBadge, StatusBadge } from "@/components/state-badge";
import { useBlocked } from "@/components/blocked-context";
import {
  KebabMenu,
  OriginBadge,
  PublishHideButtons,
  SuppressedBadge,
  blockActions,
} from "@/components/common";
import { HistoryPanel } from "@/components/history-panel";
import { PointCardContext, type PointCardApi } from "@/components/point-card-context";
import { PointEditDialog } from "@/components/point-forms";
import { PointPhotos } from "@/components/point-photos";
import {
  act,
  actDeletePoint,
  actDismissReports,
  actHide,
  actRestorePoint,
  closeTargetReports,
} from "@/lib/actions";
import { mapLink } from "@/lib/coords";
import {
  CATEGORY_LABEL,
  FLAG_LABEL,
  TARGET_LABEL,
  fmtDate,
} from "@/lib/labels";
import {
  descriptionContributor,
  fetchCommentsForPoint,
  fetchDescriptionById,
  fetchIsSuppressed,
  fetchReportsForPoint,
  type CommentItem,
  type DescriptionItem,
  type ReportItem,
} from "@/lib/moderation";
import { SHELTER_TYPE_LABEL } from "@/lib/taxonomy";

const CARD_PARAM = "punkt";

function setCardInUrl(pointId: string | null) {
  const url = new URL(window.location.href);
  if (pointId) url.searchParams.set(CARD_PARAM, pointId);
  else url.searchParams.delete(CARD_PARAM);
  window.history.pushState(null, "", url);
}

// Karta i edycja mają jednego właściciela, bo otwierają je wiersze z każdej zakładki.
export function PointCardProvider({ children }: { children: ReactNode }) {
  const [pointId, setPointId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get(CARD_PARAM));
  const [editing, setEditing] = useState<{ point: DescriptionItem; onSaved?: () => void } | null>(null);

  useEffect(() => {
    const sync = () => setPointId(new URLSearchParams(window.location.search).get(CARD_PARAM));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const api = useMemo<PointCardApi>(() => ({
    openCard: (id) => {
      setCardInUrl(id);
      setPointId(id);
    },
    openEdit: (id, onSaved) => {
      fetchDescriptionById(id)
        .then((point) => {
          if (point) setEditing({ point, onSaved });
          else toast.error("Tego punktu nie ma już w bazie.");
        })
        .catch((e) => toast.error("Nie udało się wczytać punktu: " + (e instanceof Error ? e.message : "błąd")));
    },
  }), []);

  return (
    <PointCardContext.Provider value={api}>
      {children}
      {pointId && (
        <PointCard
          key={pointId}
          pointId={pointId}
          onClose={() => { setCardInUrl(null); setPointId(null); }}
        />
      )}
      <PointEditDialog
        point={editing?.point ?? null}
        onClose={() => setEditing(null)}
        onSaved={editing?.onSaved}
      />
    </PointCardContext.Provider>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

// Baza obok tego, co widzi użytkownik. Różnica to dowód, że ktoś punkt zmienił.
function DataRows({ p }: { p: DescriptionItem }) {
  const rows: Array<[label: string, base: string, now: string]> = [
    ["Nazwa", p.base?.name ?? "", p.name],
    [
      "Kategoria",
      p.base ? SHELTER_TYPE_LABEL[p.base.type] ?? p.base.type : "",
      SHELTER_TYPE_LABEL[p.type] ?? p.type,
    ],
    ["Telefon", "", p.phone ?? "—"],
    ["Pozycja", "", p.lat !== null ? `${p.lat}, ${p.lon}` : "—"],
  ];
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([label, base, now]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">
            {now || "—"}
            {base && base !== now && (
              <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">w bazie: {base}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CommentRow({ c, reload }: { c: CommentItem; reload: () => void }) {
  const { uids: blocked } = useBlocked();
  const ids = { pointId: c.pointId, commentId: c.commentId };
  return (
    <div className="border-l-2 pl-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{c.authorName || "Użytkownik"}</span>
        <span className="font-mono text-muted-foreground">{fmtDate(c.createdAt)}</span>
        <StateBadge state={c.state} />
        {c.status !== "active" && <StatusBadge status={c.status} />}
        <span className="ml-auto flex items-center gap-1">
          <PublishHideButtons
            onPublish={c.state !== "approved" || c.status !== "active"
              ? () => act({ action: "approveComment", ...ids }, "Opublikowano", reload)
              : undefined}
            onHide={c.status !== "removed"
              ? () => actHide({ action: "rejectComment", ...ids }, "komentarz", "Ukryto", reload)
              : undefined}
          />
          <KebabMenu actions={blockActions(c.authorUid, c.authorName, blocked, reload)} />
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words">{c.text || "[brak treści]"}</p>
    </div>
  );
}

function ReportsBlock({ pointId, reports, reload }: { pointId: string; reports: ReportItem[]; reload: () => void }) {
  const open = reports.filter((r) => r.status === "open");
  const closed = reports.filter((r) => r.status !== "open");
  const label = (r: ReportItem) =>
    r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";
  if (reports.length === 0) return <p className="text-xs text-muted-foreground">Brak zgłoszeń.</p>;
  const pointOpen = open.some((r) => !r.commentId);
  return (
    <div className="space-y-2">
      {[...open, ...closed].map((r) => (
        <div key={r.id} className="text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">{TARGET_LABEL[r.target] ?? r.target}: {label(r)}</span>
            <span className="font-mono text-muted-foreground">{fmtDate(r.createdAt)}</span>
            <span className="text-muted-foreground">
              {r.status === "open" ? "otwarte" : r.resolution === "dismissed" ? "odrzucone" : "załatwione"}
            </span>
          </div>
          {r.reason && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{r.reason}</p>}
          {r.decisionReason && <p className="text-xs">Powód decyzji: {r.decisionReason}</p>}
        </div>
      ))}
      {pointOpen && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => closeTargetReports({ pointId }, "actioned", {}, reload)}>
            Zamknij jako załatwione
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => actDismissReports({ pointId }, reload)}>
            Odrzuć zgłoszenia
          </Button>
        </div>
      )}
    </div>
  );
}

function PointCard({ pointId, onClose }: { pointId: string; onClose: () => void }) {
  const { uids: blocked } = useBlocked();
  // undefined = ładowanie, null = punktu nie ma.
  const [point, setPoint] = useState<DescriptionItem | null | undefined>(undefined);
  const [suppressed, setSuppressed] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Zmiana klucza odświeża dzieci, które same ładują dane (historia, zdjęcia).
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => {
    Promise.all([
      fetchDescriptionById(pointId),
      fetchIsSuppressed(pointId),
      fetchCommentsForPoint(pointId),
      fetchReportsForPoint(pointId),
    ])
      .then(([p, s, c, r]) => {
        setPoint(p);
        setSuppressed(s);
        setComments(c);
        setReports(r);
        setError(null);
        setRevision((v) => v + 1);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "błąd"));
  }, [pointId]);

  useEffect(() => { reload(); }, [reload]);

  const autor = point ? descriptionContributor(point) : null;
  const closeAll = () =>
    closeTargetReports({ pointId }, "actioned", { includeComments: true }, reload);

  return (
    // modal={false}: edycja i potwierdzenie to osobne okna nad kartą. Pułapka fokusu
    // karty zabierałaby im klawiaturę, a klik w nie zamykałby kartę. Dlatego zamykanie
    // kliknięciem poza kartą idzie tylko przez jej własne tło.
    <Dialog open modal={false} disablePointerDismissal onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onBackdropClick={onClose} className="left-auto right-0 top-0 h-full max-h-full w-full max-w-3xl translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 data-[ending-style]:scale-100 data-[starting-style]:scale-100">
        {error ? (
          <>
            <DialogTitle>Karta punktu</DialogTitle>
            <p className="text-sm text-destructive">Nie udało się wczytać punktu: {error}</p>
          </>
        ) : point === undefined ? (
          <>
            <DialogTitle>Karta punktu</DialogTitle>
            <p className="text-sm text-muted-foreground">Ładowanie…</p>
          </>
        ) : point === null ? (
          <>
            <DialogTitle>Karta punktu</DialogTitle>
            <p className="text-sm text-muted-foreground">Tego punktu nie ma ani w bazie, ani w Firestore.</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground break-all">{pointId}</p>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <DialogTitle className="mb-1">{point.name || SHELTER_TYPE_LABEL[point.type] || "Punkt bez nazwy"}</DialogTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <OriginBadge origin={point.origin} createdVia={point.createdVia} />
                {suppressed && <SuppressedBadge />}
                {point.status !== "active" && point.hasDoc && <StatusBadge status={point.status} />}
                {point.isTest && <span className="text-[10px] text-amber-700">TEST</span>}
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">{pointId}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edytuj
              </Button>
              {suppressed ? (
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => actRestorePoint(pointId, point.name, reload)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Przywróć na mapę
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-red-600/40 px-2 text-red-700 hover:bg-red-600/10 dark:text-red-500"
                  onClick={() => actDeletePoint(pointId, point.name, closeAll)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Usuń
                </Button>
              )}
              {mapLink(point.lat, point.lon) && (
                <a
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
                  href={mapLink(point.lat, point.lon)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Pokaż na mapie <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <KebabMenu actions={[
                ...(point.createdVia === "moderation-panel" ? [] :
                  blockActions(point.authorUid, point.authorName, blocked, reload, "Zablokuj autora punktu")),
                ...(autor?.uid && autor.uid !== point.authorUid
                  ? blockActions(autor.uid, autor.name, blocked, reload, "Zablokuj autora opisu")
                  : []),
              ]} />
            </div>

            <Block title="Dane"><DataRows p={point} /></Block>

            <Block title="Opis">
              {point.description ? (
                <>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <StateBadge state={point.state} />
                    <span className="text-muted-foreground">{autor?.name ?? "Autor nieznany"}</span>
                    <span className="font-mono text-muted-foreground">{fmtDate(point.descriptionAddedAt)}</span>
                    <span className="ml-auto">
                      <PublishHideButtons
                        onPublish={point.state !== "approved"
                          ? () => act({ action: "approveDescription", pointId }, "Opublikowano", reload)
                          : undefined}
                        onHide={point.state !== "rejected"
                          ? () => actHide({ action: "rejectDescription", pointId }, "opis", "Ukryto", reload)
                          : undefined}
                      />
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{point.description}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Bez opisu.</p>
              )}
              {point.phonePending && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Telefon od użytkownika czeka na decyzję: {point.phonePending}
                </p>
              )}
            </Block>

            <Block title="Zdjęcia"><PointPhotos key={revision} pointId={pointId} /></Block>

            <Block title={`Zgłoszenia (${reports.length})`}>
              <ReportsBlock pointId={pointId} reports={reports} reload={reload} />
            </Block>

            <Block title={`Komentarze (${comments.length})`}>
              {comments.length === 0
                ? <p className="text-xs text-muted-foreground">Brak komentarzy.</p>
                : <div className="space-y-2">{comments.map((c) => <CommentRow key={c.commentId} c={c} reload={reload} />)}</div>}
            </Block>

            <Block title="Historia decyzji"><HistoryPanel key={revision} pointId={pointId} commentId={null} /></Block>
          </div>
        )}
        <PointEditDialog
          point={editing ? point ?? null : null}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      </DialogContent>
    </Dialog>
  );
}
