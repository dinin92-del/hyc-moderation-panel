"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBlocked } from "@/components/blocked-context";
import { Empty, KebabMenu, QueueError, Section, blockActions } from "@/components/common";
import { usePointCard } from "@/components/point-card-context";
import { inFlight } from "@/lib/actions";
import { confirmDialog } from "@/lib/confirm";
import { mapLink } from "@/lib/coords";
import { fmtDate } from "@/lib/labels";
import { fetchPhotosForPoint, type PhotoItem } from "@/lib/moderation";
import { formatPhoneDisplay } from "@/lib/phone";
import { decidePointEdit, type PointEditItem } from "@/lib/point-edits";
import { SHELTER_TYPE_LABEL } from "@/lib/taxonomy";

type DiffRow = { label: string; before: React.ReactNode; after: React.ReactNode };

const typeLabel = (t: string | null | undefined) => (t ? SHELTER_TYPE_LABEL[t] ?? t : "—");
const phoneLabel = (p: string | null | undefined) => (p ? formatPhoneDisplay(p) : "brak");

function coords(lat: number | null | undefined, lon: number | null | undefined) {
  if (lat == null || lon == null) return "—";
  const href = mapLink(lat, lon);
  const text = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{text}</a> : text;
}

function diffRows(e: PointEditItem): DiffRow[] {
  const p = e.proposed;
  const rows: DiffRow[] = [];
  if (p.name !== undefined) rows.push({ label: "Nazwa", before: e.base.name || "—", after: p.name });
  if (p.type !== undefined) rows.push({ label: "Kategoria", before: typeLabel(e.base.type), after: typeLabel(p.type) });
  if (p.phone !== undefined) rows.push({ label: "Telefon", before: phoneLabel(e.base.phone), after: phoneLabel(p.phone) });
  if (p.lat !== undefined) {
    rows.push({ label: "Położenie", before: coords(e.base.lat, e.base.lon), after: coords(p.lat, p.lon) });
  }
  if (p.description !== undefined) {
    rows.push({ label: "Opis", before: e.base.description || "—", after: p.description ?? "usunięty" });
  }
  return rows;
}

// Zdjęcia do zdjęcia. Bez miniatur moderator zatwierdzałby usunięcie w ciemno.
function RemovedPhotos({ pointId, ids }: { pointId: string; ids: string[] }) {
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  // Każda migawka kolejki daje nową tablicę, więc zależność po treści.
  const idsKey = ids.join("|");
  useEffect(() => {
    let alive = true;
    const wanted = new Set(idsKey.split("|"));
    fetchPhotosForPoint(pointId)
      .then((all) => alive && setPhotos(all.filter((f) => wanted.has(f.id))))
      .catch(() => alive && setPhotos([]));
    return () => { alive = false; };
  }, [pointId, idsKey]);
  if (photos === null) return <p className="text-xs text-muted-foreground">Ładowanie zdjęć…</p>;
  const missing = ids.length - photos.length;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {photos.map((f) => (
        <a key={f.id} href={f.fullUrl} target="_blank" rel="noreferrer" title={`Autor: ${f.authorName || "Użytkownik"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.thumbUrl} alt="Zdjęcie do usunięcia" className="h-20 w-20 rounded object-cover ring-2 ring-red-500" />
        </a>
      ))}
      {missing > 0 && (
        <p className="text-xs text-muted-foreground">
          {missing === 1 ? "1 zdjęcie już nie istnieje." : `${missing} zdjęcia już nie istnieją.`}
        </p>
      )}
    </div>
  );
}

async function decide(e: PointEditItem, approve: boolean) {
  const ok = await confirmDialog(approve
    ? {
      title: "Zatwierdzić zmiany?",
      body: e.removePhotoIds.length
        ? "Zmiany wejdą do aplikacji, a wskazane zdjęcia znikną. Autor propozycji dostanie mail."
        : "Zmiany wejdą do aplikacji. Autor propozycji dostanie mail.",
      confirmLabel: "Zatwierdź",
    }
    : {
      title: "Odrzucić zmiany?",
      body: "Punkt zostaje bez zmian. Powód trafi w mailu do autora propozycji.",
      confirmLabel: "Odrzuć",
      destructive: true,
      reason: { label: "Powód (trafi do autora)", minLength: 3 },
    });
  if (!ok) return;
  const key = `edit:${e.id}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await decidePointEdit(e.id, approve, e.at, ok.reason);
    toast.success(approve ? "Zmiany zatwierdzone" : "Zmiany odrzucone");
  } catch (err) {
    toast.error("Nie udało się: " + (err instanceof Error ? err.message : "błąd"));
  } finally {
    inFlight.delete(key);
  }
}

export function EditsTab({ items, error }: { items: PointEditItem[]; error: string | null }) {
  const { uids: blocked } = useBlocked();
  const { openCard } = usePointCard();
  return (
    <Section title="Zmiany od użytkowników" count={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : items.length === 0 ? (
        <Empty text="Brak propozycji zmian." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Autor / Punkt</TableHead>
              <TableHead>Zmiany (było, będzie)</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-60 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="align-top text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="break-words">{e.authorName}</span>
                    <button
                      type="button"
                      className="break-words text-left font-medium underline-offset-2 hover:underline"
                      title={e.pointId}
                      onClick={() => openCard(e.pointId)}
                    >
                      {e.base.name || typeLabel(e.base.type)}
                    </button>
                  </div>
                </TableCell>
                <TableCell className="align-top text-sm">
                  <dl className="space-y-2">
                    {diffRows(e).map((r) => (
                      <div key={r.label}>
                        <dt className="text-xs font-semibold text-muted-foreground">{r.label}</dt>
                        <dd className="whitespace-pre-wrap break-words text-muted-foreground line-through decoration-red-500/60">{r.before}</dd>
                        <dd className="whitespace-pre-wrap break-words">{r.after}</dd>
                      </div>
                    ))}
                    {e.removePhotoIds.length > 0 && (
                      <div>
                        <dt className="text-xs font-semibold text-muted-foreground">Zdjęcia do usunięcia</dt>
                        <dd><RemovedPhotos pointId={e.pointId} ids={e.removePhotoIds} /></dd>
                      </div>
                    )}
                  </dl>
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(e.at)}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" className="gap-1 bg-green-600 text-white hover:bg-green-700" onClick={() => decide(e, true)}>
                      <Check className="h-4 w-4" /> Zatwierdź
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => decide(e, false)}>
                      <X className="h-4 w-4" /> Odrzuć
                    </Button>
                    <KebabMenu actions={[
                      { label: "Karta punktu", onClick: () => openCard(e.pointId) },
                      ...blockActions(e.uid, e.authorName, blocked),
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
