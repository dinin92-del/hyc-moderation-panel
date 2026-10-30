"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchPhotosForPoint, moderatorDeletePhoto, type PhotoItem } from "@/lib/moderation";
import { inFlight } from "@/lib/actions";

/**
 * Zdjęcia punktu w podglądzie — moderacja zdjęć (wymóg sklepów: moderator musi
 * móc zdjąć cudze zdjęcie; callable photoModeratorDelete). Ładowane dopiero
 * przy ROZWINIĘCIU podglądu, nie per wiersz listy. Usunięte pokazujemy tylko
 * liczbą (wgląd bez szumu); punkt bez zdjęć nie renderuje sekcji wcale.
 */
export function PointPhotos({ pointId }: { pointId: string }) {
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
  if (!photos) return null;
  const visible = photos.filter((f) => f.status === "visible" && !gone.has(f.id));
  const removedCount = photos.filter((f) => f.status === "removed").length + gone.size;
  if (visible.length === 0 && removedCount === 0) return null;

  async function remove(f: PhotoItem) {
    if (
      !window.confirm(
        `Usunąć zdjęcie autorstwa „${f.authorName || "Użytkownik"}"? Zniknie z aplikacji.`,
      )
    )
      return;
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

  return (
    <div className="mt-2">
      <span className="text-xs font-medium text-muted-foreground">
        Zdjęcia ({visible.length}
        {removedCount ? `, usuniętych: ${removedCount}` : ""})
      </span>
      <div className="mt-1 flex flex-wrap gap-2">
        {visible.map((f) => (
          <figure key={f.id} className="w-28">
            {/* Po sanityzacji adres bywa pusty — wtedy kotwica bez href
                (miniatura zostaje, bez klikalnego wyjścia donikąd). */}
            <a href={f.fullUrl || undefined} target="_blank" rel="noreferrer" title="Otwórz pełny rozmiar">
              {/* eslint-disable-next-line @next/next/no-img-element -- thumb z R2, bez optymalizatora Nexta */}
              <img
                src={f.thumbUrl}
                alt={`Zdjęcie — ${f.authorName || "Użytkownik"}`}
                className="h-28 w-28 rounded border object-cover"
                loading="lazy"
              />
            </a>
            <figcaption
              className="mt-0.5 truncate text-[10px] text-muted-foreground"
              title={f.authorUid}
            >
              {f.authorName || "Użytkownik"}
            </figcaption>
            <Button
              size="sm"
              variant="outline"
              className="mt-0.5 h-6 w-full px-1 text-[11px] text-destructive hover:bg-destructive/10"
              onClick={() => remove(f)}
            >
              Usuń zdjęcie
            </Button>
          </figure>
        ))}
      </div>
    </div>
  );
}
