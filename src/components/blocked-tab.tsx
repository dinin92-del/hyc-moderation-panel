"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBlocked } from "@/components/blocked-context";
import { Empty, KebabMenu, QueueError, Section } from "@/components/common";
import { actUnblock } from "@/lib/actions";
import { fmtDate } from "@/lib/labels";
import { fetchUserNames } from "@/lib/moderation";

const SYSTEM_BLOCK = "system";

export function BlockedTab() {
  const { rows, error: err } = useBlocked();
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    let alive = true;
    const uids = [...new Set(rows.flatMap((b) => [b.uid, b.blockedBy]))]
      .filter((u) => u && u !== SYSTEM_BLOCK)
      .slice(0, 200);
    fetchUserNames(uids).then((m) => alive && setNames(m)).catch(() => {/* zostaje uid */});
    return () => { alive = false; };
  }, [rows]);

  if (rows === null) return <Empty text="Ładowanie…" />;

  return (
    <Section title="Zablokowani autorzy" count={rows.length}>
      {err ? (
        <QueueError message={err} />
      ) : rows.length === 0 ? (
        <Empty text="Brak zablokowanych autorów." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Autor</TableHead>
              <TableHead className="w-56">Powód</TableHead>
              <TableHead className="w-40">Kto zablokował</TableHead>
              <TableHead className="w-36">Kiedy</TableHead>
              <TableHead className="w-12 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.uid}>
                <TableCell className="align-top text-sm" title={b.uid}>
                  <div>{names.get(b.uid) ?? "Użytkownik"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground break-all">{b.uid}</div>
                </TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">
                  <p className="whitespace-pre-wrap break-words">{b.reason || "—"}</p>
                </TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">
                  {b.blockedBy === SYSTEM_BLOCK ? "Automat" : names.get(b.blockedBy) ?? "Moderator"}
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(b.blockedAt)}</TableCell>
                <TableCell className="align-top text-right">
                  <KebabMenu actions={[{ label: "Odblokuj", onClick: () => actUnblock(b.uid) }]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
