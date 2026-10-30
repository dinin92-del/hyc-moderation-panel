"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/confirm";
import { fetchPhotosForPoint, moderatorDeletePhoto, type PhotoItem } from "@/lib/moderation";
import { inFlight } from "@/lib/actions";

const PHOTO_STATUS_LABEL: Record<string, string> = {
  uploaded: "Czeka na decyzję",
  pending: "Przesyłane",
};

function usePhotos(pointId: string) {
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  // Zdjęcia zdjęte w tej sesji — optymistyczne zejście z listy bez refetcha.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    fetchPhotosForPoint(pointId)
      .then((f) => alive && setPhotos(f))
      .catch(() => alive && setPhotos([]));
    return () => {
      alive = false;
    };
  }, [pointId]);

  async function remove(f: PhotoItem) {
    const ok = await confirmDialog({
      title: `Usunąć zdjęcie autorstwa „${f.authorName || "Użytkownik"}"?`,
      body: "Zniknie z aplikacji.",
      confirmLabel: "Usuń zdjęcie",
      destructive: true,
    });
    if (!ok) return;
    const key = `photo:${f.id}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      await moderatorDeletePhoto(f.id);
      setGone((g) => new Set(g).add(f.id));
      toast.success("Zdjęcie usunięte");
    } catch (e) {
      toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
    } finally {
      inFlight.delete(key);
    }
  }

  return { photos, gone, remove };
}

function PhotoTile({ f, onRemove }: { f: PhotoItem; onRemove: (f: PhotoItem) => void }) {
  return (
    <figure className="w-28">
      {/* Po sanityzacji adres bywa pusty — wtedy kotwica bez href
          (miniatura zostaje, bez klikalnego wyjścia donikąd). */}
      <a href={f.fullUrl || undefined} target="_blank" rel="noreferrer" title="Otwórz pełny rozmiar">
        {/* eslint-disable-next-line @next/next/no-img-element -- thumb z R2, bez optymalizatora Nexta */}
        <img
          src={f.thumbUrl}
          alt={`Zdjęcie: ${f.authorName || "Użytkownik"}`}
          className="h-28 w-28 rounded border object-cover"
          loading="lazy"
        />
      </a>
      <figcaption className="mt-0.5 truncate text-[10px] text-muted-foreground" title={f.authorUid}>
        {f.authorName || "Użytkownik"}
      </figcaption>
      {PHOTO_STATUS_LABEL[f.status] && (
        <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
          {PHOTO_STATUS_LABEL[f.status]}
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-0.5 h-6 w-full px-1 text-[11px] text-destructive hover:bg-destructive/10"
        onClick={() => onRemove(f)}
      >
        Usuń zdjęcie
      </Button>
    </figure>
  );
}

/**
 * Zdjęcia punktu na karcie — moderacja zdjęć (wymóg sklepów: moderator musi móc zdjąć
 * cudze zdjęcie; callable photoModeratorDelete). Usunięte pokazujemy tylko liczbą,
 * pliki już nie istnieją.
 */
export function PointPhotos({ pointId }: { pointId: string }) {
  const { photos, gone, remove } = usePhotos(pointId);
  if (!photos) return <p className="text-xs text-muted-foreground">Ładowanie zdjęć…</p>;
  const shown = photos.filter((f) => f.status !== "removed" && !gone.has(f.id));
  const removedCount = photos.filter((f) => f.status === "removed").length + gone.size;
  if (shown.length === 0 && removedCount === 0) {
    return <p className="text-xs text-muted-foreground">Brak zdjęć.</p>;
  }
  return (
    <div>
      {removedCount > 0 && (
        <p className="text-xs text-muted-foreground">Usuniętych: {removedCount}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {shown.map((f) => <PhotoTile key={f.id} f={f} onRemove={remove} />)}
      </div>
    </div>
  );
}

/** Zdjęcia czekające na decyzję, widoczne wprost w wierszu kolejki. */
export function PendingPhotos({ pointId }: { pointId: string }) {
  const { photos, gone, remove } = usePhotos(pointId);
  const shown = (photos ?? []).filter((f) => f.status === "uploaded" && !gone.has(f.id));
  if (shown.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {shown.map((f) => <PhotoTile key={f.id} f={f} onRemove={remove} />)}
    </div>
  );
}
