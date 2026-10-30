"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { watchBlockedUsers, type BlockedItem } from "@/lib/moderation";

// Jedno źródło prawdy o blokadach dla CAŁEJ strony: jedna subskrypcja
// `watchBlockedUsers`, nie osobna w każdej zakładce. Bez tego kolejki nie
// wiedziały, kto jest już zablokowany, i kebab oferował wyłącznie „Zablokuj
// autora" — odblokować dało się tylko z „Wszystkich treści".
type BlockedState = {
  /** null = jeszcze się ładuje (zakładka „Zablokowani" pokazuje wtedy „Ładowanie…"). */
  rows: BlockedItem[] | null;
  /** Zbiór uid — do etykiety „Zablokuj"/„Odblokuj" w kebabie. */
  uids: Set<string>;
  error: string | null;
};

const BlockedContext = createContext<BlockedState>({ rows: null, uids: new Set(), error: null });
export const useBlocked = () => useContext(BlockedContext);

export function BlockedProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<BlockedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchBlockedUsers(
    (items) => { setError(null); setRows(items); },
    () => {
      setError("Nie udało się wczytać listy zablokowanych.");
      setRows([]);
      toast.error("Błąd listy zablokowanych — status „zablokowany” może być nieaktualny.");
    },
  ), []);
  const value = useMemo<BlockedState>(
    () => ({ rows, uids: new Set((rows ?? []).map((b) => b.uid)), error }),
    [rows, error],
  );
  return <BlockedContext.Provider value={value}>{children}</BlockedContext.Provider>;
}
