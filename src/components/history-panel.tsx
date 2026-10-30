"use client";

import { useEffect, useState } from "react";
import { StateBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { fetchLogFor, fetchUserNames, type LogItem } from "@/lib/moderation";
import { FIELD_LABEL, LOG_TARGET_LABEL, aiLabel, fmtDate } from "@/lib/labels";

// Historia decyzji JEDNEJ treści albo całego punktu (bez `commentId`).
export function HistoryPanel({ pointId, commentId }: { pointId: string; commentId: string | null }) {
  // undefined = ładowanie, null = błąd, [] = brak wpisów.
  const [rows, setRows] = useState<LogItem[] | null | undefined>(undefined);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    fetchLogFor(pointId, commentId)
      .then((r) => {
        if (!alive) return;
        setRows(r);
        const uids = [...new Set(r.map((x) => x.human?.reviewerUid).filter((u) => !!u))] as string[];
        if (uids.length) void fetchUserNames(uids).then((m) => alive && setNames(m)).catch(() => {});
      })
      .catch(() => alive && setRows(null));
    return () => { alive = false; };
  }, [pointId, commentId]);

  if (rows === undefined) return <span className="text-xs text-muted-foreground">Ładowanie historii…</span>;
  if (rows === null) return <span className="text-xs text-destructive">Nie udało się wczytać historii decyzji.</span>;
  if (rows.length === 0) return <span className="text-xs text-muted-foreground">Brak wpisów w historii decyzji.</span>;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const fields = [...new Set(r.changedFields.map((f) => FIELD_LABEL[f] ?? f))];
        return (
          <div key={r.id} className="border-l-2 pl-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-muted-foreground">{fmtDate(r.createdAt)}</span>
              <span className="font-medium">{LOG_TARGET_LABEL[r.targetType] ?? r.targetType}</span>
              {r.ai && <span className="inline-flex items-center gap-1">Filtr: <StateBadge state={r.ai.state} /></span>}
              {r.human && (
                <span className="inline-flex items-center gap-1">
                  {r.human.reviewerUid ? names.get(r.human.reviewerUid) ?? "Moderator" : "Moderator"}:
                  <StateBadge state={r.human.state} />
                </span>
              )}
              {r.overrodeAI && <Badge variant="destructive">wbrew filtrowi</Badge>}
            </div>
            {fields.length > 0 && <div className="text-muted-foreground">Zmiany: {fields.join(", ")}</div>}
            {r.human?.reason && <div>Powód: {r.human.reason}</div>}
            {r.ai?.reason && <div className="text-muted-foreground">Filtr: {r.ai.reason}</div>}
            {r.ai?.labels && r.ai.labels.length > 0 && (
              <div className="text-muted-foreground">{r.ai.labels.map(aiLabel).join(", ")}</div>
            )}
            {r.text && <div className="line-clamp-2 text-muted-foreground">„{r.text}”</div>}
          </div>
        );
      })}
    </div>
  );
}
