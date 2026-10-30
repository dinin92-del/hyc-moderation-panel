"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StateBadge } from "@/components/state-badge";
import { Empty, FilterChips, OriginBadge, QueueError, Section, SuppressedBadge } from "@/components/common";
import { usePointCard } from "@/components/point-card-context";
import { parseLatLon } from "@/lib/coords";
import { searchPoints, type PointHit, type PointSearchInput, type PointView } from "@/lib/moderation";
import { SHELTER_TYPE_LABEL, TAXONOMY_OPTIONS } from "@/lib/taxonomy";

const SEARCH_DELAY_MS = 350;
const ALL_TYPES = "__all";

const VIEWS: { value: PointView; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  { value: "suppressed", label: "Usunięte" },
  { value: "ugc", label: "Od użytkowników" },
  { value: "edited", label: "Poprawione" },
];

function fmtDistance(m: number | undefined): string {
  if (m === undefined) return "";
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

// Wklejone współrzędne albo link z mapy szukają wokół miejsca, reszta po tekście.
function toInput(text: string, type: string, view: PointView): PointSearchInput {
  const near = parseLatLon(text) ?? undefined;
  return {
    ...(near ? { near } : { q: text.trim() }),
    ...(type !== ALL_TYPES ? { type } : {}),
    view,
  };
}

export function PointsTab() {
  const { openCard } = usePointCard();
  const [text, setText] = useState("");
  const [type, setType] = useState(ALL_TYPES);
  const [view, setView] = useState<PointView>("all");
  const [result, setResult] = useState<{ hits: PointHit[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idle = view === "all" && type === ALL_TYPES && text.trim() === "";

  useEffect(() => {
    if (idle) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      searchPoints(toInput(text, type, view))
        .then((r) => {
          if (!alive) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "błąd"))
        .finally(() => alive && setLoading(false));
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [idle, text, type, view]);

  const hits = idle ? [] : result?.hits ?? [];
  const total = idle ? 0 : result?.total ?? 0;
  const showDistance = hits.some((h) => h.distanceM !== undefined);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nazwa, id, telefon, autor albo współrzędne i link z mapy"
          className="h-9 min-w-72 flex-1"
          autoFocus
        />
        <Select value={type} onValueChange={(v) => setType(v ?? ALL_TYPES)}>
          <SelectTrigger className="w-56">
            <SelectValue>{(v: string) => (v === ALL_TYPES ? "Każda kategoria" : SHELTER_TYPE_LABEL[v] ?? v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>Każda kategoria</SelectItem>
            {TAXONOMY_OPTIONS.map(([code, label]) => (
              <SelectItem key={code} value={code}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterChips<PointView> value={view} onChange={setView} options={VIEWS} />
      </div>

      <Section title={loading ? "Szukam…" : "Punkty"} count={total}>
        {error ? (
          <QueueError message={`Nie udało się wyszukać: ${error}`} />
        ) : idle ? (
          <Empty text="Wpisz nazwę, id, numer telefonu, autora albo wklej współrzędne. Szukamy w całej bazie." />
        ) : hits.length === 0 ? (
          <Empty text={loading ? "Szukam…" : "Nic nie znaleziono."} />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Nazwa</TableHead>
                <TableHead className="w-44">Kategoria</TableHead>
                <TableHead className="w-44">Pochodzenie</TableHead>
                <TableHead className="w-32">Stan</TableHead>
                <TableHead className="w-36">Telefon</TableHead>
                {showDistance && <TableHead className="w-24">Odległość</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {hits.map((h) => (
                <TableRow key={h.id} className="cursor-pointer" onClick={() => openCard(h.id)}>
                  <TableCell className="align-top text-sm">
                    <span className="break-words font-medium">{h.name || "Punkt bez nazwy"}</span>
                    <div className="font-mono text-[10px] text-muted-foreground break-all">{h.id}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">{h.type ? SHELTER_TYPE_LABEL[h.type] ?? h.type : "—"}</TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-1">
                      <OriginBadge origin={h.origin} createdVia={h.createdVia} />
                      {h.suppressed && <SuppressedBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{h.state ? <StateBadge state={h.state} /> : "—"}</TableCell>
                  <TableCell className="align-top text-sm">{h.phone ?? "—"}</TableCell>
                  {showDistance && <TableCell className="align-top text-sm">{fmtDistance(h.distanceM)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > hits.length && (
          <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-700">
            Pokazano {hits.length} z {total}. Zawęź wyszukiwanie.
          </div>
        )}
      </Section>
    </div>
  );
}
