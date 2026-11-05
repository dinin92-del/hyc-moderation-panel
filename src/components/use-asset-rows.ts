"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchPointBase, type DescriptionItem, type PointBase } from "@/lib/moderation";
import { withAssetBase } from "@/lib/point-attrs";

/**
 * Wiersze listy z nazwą i typem jak na karcie punktu. Wiersz niesie tylko dokument,
 * a dla punktu z assetu dokument bywa nieaktualną kopią (opis zespołu), więc lista
 * pokazywała inną nazwę niż karta. Baza dochodzi po pierwszym wyrenderowaniu, bo to
 * wywołanie funkcji; do tego czasu wiersz jest taki jak z dokumentu. Awaria odczytu
 * zostawia wiersz bez zmian, lista nie może znikać razem z indeksem.
 *
 * Wiersze liczone przy renderze, a nie podmieniane w stanie rodzica, żeby dociągnięcie
 * bazy nie odpalało drugi raz efektów, które czytają listę.
 */
export function useAssetRows(items: DescriptionItem[]): DescriptionItem[] {
  const [bases, setBases] = useState<Map<string, PointBase>>(new Map());
  useEffect(() => {
    let alive = true;
    void Promise.all(
      items.map((p) => fetchPointBase(p.pointId).then((b) => [p.pointId, b] as const).catch(() => null)),
    ).then((found) => {
      if (!alive) return;
      const next = new Map<string, PointBase>();
      for (const f of found) if (f && f[1]) next.set(f[0], f[1]);
      setBases(next);
    });
    return () => { alive = false; };
  }, [items]);
  return useMemo(
    () => items.map((p) => {
      const base = bases.get(p.pointId);
      return base ? withAssetBase(p, base) : p;
    }),
    [items, bases],
  );
}
