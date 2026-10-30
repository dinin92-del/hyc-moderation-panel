"use client";

import { useEffect, useState } from "react";
import { StateBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { fetchLogFor, type LogItem } from "@/lib/moderation";
import { fmtDate } from "@/lib/labels";

// Historia decyzji JEDNEJ treści — rozwijana chevronem w „Wszystkie treści"
// (zastąpiła globalną zakładkę „Historia decyzji": decyzję czyta się przy
// treści, której dotyczy, nie w oderwanym logu).
export function HistoryPanel({ pointId, commentId }: { pointId: string; commentId: string | null }) {
  // undefined = ładowanie, null = błąd, [] = brak wpisów.
  const [rows, setRows] = useState<LogItem[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchLogFor(pointId, commentId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows(null));
    return () => { alive = false; };
  }, [pointId, commentId]);

  if (rows === undefined) return <span className="text-xs text-muted-foreground">Ładowanie historii…</span>;
  if (rows === null) return <span className="text-xs text-destructive">Nie udało się wczytać historii decyzji.</span>;
  if (rows.length === 0) return <span className="text-xs text-muted-foreground">Brak wpisów w historii decyzji.</span>;
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">Historia decyzji</span>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{fmtDate(r.createdAt)}</span>
          {r.ai && <span className="inline-flex items-center gap-1">AI: <StateBadge state={r.ai.state} /></span>}
          {r.human && <span className="inline-flex items-center gap-1">Człowiek: <StateBadge state={r.human.state} /></span>}
          {r.overrodeAI && <Badge variant="destructive">override</Badge>}
          {r.text && <span className="line-clamp-1 max-w-96 text-muted-foreground">„{r.text}”</span>}
        </div>
      ))}
    </div>
  );
}
