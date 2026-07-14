"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, ExternalLink, Droplets, Flame, Moon, TriangleAlert } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { EnvSwitch, EnvBanner } from "@/components/env-switch";
import { StateBadge, StatusBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  decide,
  setUserBlock,
  fetchAllComments,
  fetchAllDescriptions,
  watchHistory,
  watchCommentsQueue,
  watchDescriptionsQueue,
  watchReportsQueue,
  type CommentItem,
  type DescriptionItem,
  type LogItem,
  type ReportItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, fmtDate } from "@/lib/labels";

export default function Home() {
  return <AuthGate>{({ user, signOut }) => <Panel email={user.email ?? ""} signOut={signOut} />}</AuthGate>;
}

let actInFlight = false;
async function act(input: Parameters<typeof decide>[0], okMsg: string, after?: () => void) {
  if (actInFlight) return;
  actInFlight = true;
  try {
    await decide(input);
    toast.success(okMsg);
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    actInFlight = false;
  }
}

// Blokada autora — osobny callable (setUserBlock), z twardym potwierdzeniem.
// Wymaga authorUid; przy braku (starsze dokumenty) informuje zamiast cicho paść.
async function actBlock(targetUid: string, authorName: string, after?: () => void) {
  if (!targetUid) {
    toast.error("Brak identyfikatora autora — nie można zablokować.");
    return;
  }
  if (
    !window.confirm(
      `Zablokować autora „${authorName || "Użytkownik"}"? Nie będzie mógł dodawać ` +
        "opisów, komentarzy ani zgłoszeń, dopóki go nie odblokujesz.",
    )
  )
    return;
  if (actInFlight) return;
  actInFlight = true;
  try {
    await setUserBlock(targetUid, true);
    toast.success("Autor zablokowany");
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    actInFlight = false;
  }
}

function mapLink(lat: number | null, lon: number | null): string | undefined {
  if (lat === null || lon === null) return undefined;
  return `https://mapy.cz/turisticka?x=${lon}&y=${lat}&z=16`;
}

function Panel({ email, signOut }: { email: string; signOut: () => void }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [descs, setDescs] = useState<DescriptionItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [commentsErr, setCommentsErr] = useState<string | null>(null);
  const [descsErr, setDescsErr] = useState<string | null>(null);
  const [reportsErr, setReportsErr] = useState<string | null>(null);
  const [hideTest, setHideTest] = useState(false);

  useEffect(() => {
    const u1 = watchCommentsQueue(
      (items) => { setCommentsErr(null); setComments(items); },
      () => setCommentsErr("Błąd kolejki komentarzy — indeks Firestore może być jeszcze w budowie. Odśwież za chwilę."),
    );
    const u2 = watchDescriptionsQueue(
      (items) => { setDescsErr(null); setDescs(items); },
      () => setDescsErr("Błąd kolejki opisów."),
    );
    const u3 = watchReportsQueue(
      (items) => { setReportsErr(null); setReports(items); },
      () => setReportsErr("Błąd kolejki zgłoszeń."),
    );
    return () => { u1(); u2(); u3(); };
  }, []);

  const queueTotal = comments.length + descs.length + reports.length;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Panel moderatora</h1>
          <p className="text-xs text-muted-foreground">Hyc do Budy · {email}</p>
        </div>
        <div className="flex items-center gap-3">
          <EnvSwitch />
          <Button variant="outline" size="sm" onClick={signOut}>
            Wyloguj
          </Button>
        </div>
      </header>
      <EnvBanner />

      <main className="mx-auto max-w-7xl px-6 py-6">
        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger value="queue">Kolejka ({queueTotal})</TabsTrigger>
            <TabsTrigger value="history">Historia decyzji</TabsTrigger>
            <TabsTrigger value="content">Wszystkie treści</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-6 pt-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-foreground"
                checked={hideTest}
                onChange={(e) => setHideTest(e.target.checked)}
              />
              Ukryj testowe
            </label>
            <QueueComments items={comments} error={commentsErr} hideTest={hideTest} />
            <QueueDescriptions items={descs} error={descsErr} hideTest={hideTest} />
            <QueueReports items={reports} error={reportsErr} hideTest={hideTest} />
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <HistoryTab />
          </TabsContent>

          <TabsContent value="content" className="pt-4">
            <ContentTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

const SHELTER_TYPE_LABEL: Record<string, string> = {
  schronisko: "Schronisko",
  nocleg: "Nocleg",
  dom_turysty: "Nocleg",
  bacowka: "Bacówka",
  restauracja: "Restauracja",
  stanica: "Stanica",
  baza_namiotowa: "Baza namiotowa",
  miejsce_biwakowe: "Baza biwakowa",
  chatka: "Chatka",
  obserwacyjne: "Czatownia",
  schronienie_skalne: "Schronienie skalne",
  parking_zadaszony: "Zadaszony parking",
  wiata_rowerowa: "Wiata rowerowa",
  altana: "Altana",
  daszek: "Daszek",
  wiata: "Wiata",
  schronienie: "Schronienie",
  pasnik: "Paśnik",
  przystanek: "Wiata przystankowa",
  nieznane: "Typ nieznany",
};

const POINT_ATTRS: Array<{
  key: keyof Pick<DescriptionItem, "waterNearby" | "fireSpot" | "overnight" | "emergencyShelter">;
  label: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}> = [
  { key: "waterNearby",      label: "Woda",     Icon: Droplets,      color: "#008EE6" },
  { key: "fireSpot",         label: "Ognisko",  Icon: Flame,         color: "#D66000" },
  { key: "overnight",        label: "Nocleg",   Icon: Moon,          color: "#8A8070" },
  { key: "emergencyShelter", label: "Awaryjne", Icon: TriangleAlert, color: "#BC8700" },
];

function PointProps({ p }: { p: Pick<DescriptionItem, "type" | "waterNearby" | "fireSpot" | "overnight" | "emergencyShelter"> }) {
  const typeLabel = SHELTER_TYPE_LABEL[p.type] ?? p.type ?? "";
  const active = POINT_ATTRS.filter((a) => p[a.key]);

  if (!typeLabel && active.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {typeLabel && (
        <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {typeLabel}
        </span>
      )}
      {active.map(({ key, label, Icon, color }) => (
        <span key={key} title={label} className="inline-flex items-center">
          <Icon className="h-3.5 w-3.5" style={{ color, fill: color, strokeWidth: 0 }} />
        </span>
      ))}
    </div>
  );
}

function TestBadge() {
  return (
    <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
      TEST
    </span>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title} <span className="font-mono">({count})</span>
      </h2>
      <div className="overflow-hidden rounded-lg border bg-background">{children}</div>
    </section>
  );
}

function QueueError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-6 text-sm text-muted-foreground">{text}</div>;
}

function confirmReject(what: string) {
  return window.confirm(`Odrzucić ${what}? Treść zostanie ukryta.`);
}

type KebabAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "destructive";
};

function KebabMenu({ actions }: { actions: KebabAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none">
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Akcje</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {actions.map((action, i) => (
          <DropdownMenuItem
            key={i}
            variant={action.variant === "destructive" ? "destructive" : "default"}
            onClick={
              action.href
                ? () => window.open(action.href, "_blank", "noopener,noreferrer")
                : action.onClick
            }
          >
            {action.label}
            {action.href && <ExternalLink className="ml-auto h-3 w-3 opacity-60" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueComments({ items, error, hideTest }: { items: CommentItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((c) => !c.isTest) : items;
  return (
    <Section title="Komentarze do sprawdzenia" count={visible.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak komentarzy do sprawdzenia." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Autor / Punkt</TableHead>
              <TableHead>Treść</TableHead>
              <TableHead className="w-20">Zgłosz.</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-12 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c) => (
              <TableRow key={`${c.pointId}/${c.commentId}`}>
                <TableCell className="align-top text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="break-words">{c.authorName || "Użytkownik"}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{c.pointId}</span>
                    {c.isTest && <TestBadge />}
                  </div>
                </TableCell>
                <TableCell className="align-top text-sm">
                  {c.text
                    ? <p className="whitespace-pre-wrap break-words">{c.text}</p>
                    : <p className="italic text-muted-foreground">[brak treści]</p>}
                </TableCell>
                <TableCell className="align-top">
                  {c.reportCount > 0 ? <Badge variant="destructive">{c.reportCount}</Badge> : "—"}
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                <TableCell className="align-top text-right">
                  <KebabMenu
                    actions={[
                      {
                        label: "Zatwierdź",
                        onClick: () => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Zatwierdzono"),
                      },
                      {
                        label: "Odrzuć",
                        variant: "destructive",
                        onClick: () =>
                          confirmReject("komentarz") &&
                          act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Odrzucono"),
                      },
                      {
                        label: "Zablokuj autora",
                        variant: "destructive",
                        onClick: () => actBlock(c.authorUid, c.authorName),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function QueueDescriptions({ items, error, hideTest }: { items: DescriptionItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((p) => !p.isTest) : items;
  return (
    <Section title="Opisy do sprawdzenia" count={visible.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak opisów do sprawdzenia." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Punkt</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-12 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p.pointId}>
                <TableCell className="align-top text-sm font-medium">
                  <span className="break-words">{p.name || p.pointId}</span>
                  <PointProps p={p} />
                  {p.isTest && <div className="mt-1"><TestBadge /></div>}
                </TableCell>
                <TableCell className="align-top text-sm">
                  <p className="whitespace-pre-wrap break-words">{p.description}</p>
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                <TableCell className="align-top text-right">
                  <KebabMenu
                    actions={[
                      {
                        label: "Zatwierdź",
                        onClick: () => act({ action: "approveDescription", pointId: p.pointId }, "Zatwierdzono"),
                      },
                      {
                        label: "Odrzuć",
                        variant: "destructive",
                        onClick: () =>
                          confirmReject("opis") && act({ action: "rejectDescription", pointId: p.pointId }, "Odrzucono"),
                      },
                      {
                        label: "Zablokuj autora",
                        variant: "destructive",
                        onClick: () => actBlock(p.authorUid, p.authorName),
                      },
                      ...(mapLink(p.lat, p.lon)
                        ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }]
                        : []),
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function QueueReports({ items, error, hideTest }: { items: ReportItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((r) => !r.isTest) : items;
  return (
    <Section title="Zgłoszenia użytkowników" count={visible.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak otwartych zgłoszeń." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Cel</TableHead>
              <TableHead className="w-40">Przyczyna</TableHead>
              <TableHead>Powód (tekst)</TableHead>
              <TableHead className="w-12 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-1">
                    <Badge variant="outline">{TARGET_LABEL[r.target] ?? r.target}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground break-all">
                      {r.pointId}
                      {r.commentId ? `/${r.commentId}` : ""}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="align-top text-sm">
                  {r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—"}
                </TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">
                  <p className="whitespace-pre-wrap break-words">{r.reason || "—"}</p>
                </TableCell>
                <TableCell className="align-top text-right">
                  <KebabMenu
                    actions={[
                      {
                        label: "Zasadne — zamknij",
                        onClick: () => act({ action: "closeReport", reportId: r.id, resolution: "actioned" }, "Zamknięto"),
                      },
                      {
                        label: "Odrzuć zgłoszenie",
                        variant: "destructive",
                        onClick: () => act({ action: "closeReport", reportId: r.id, resolution: "dismissed" }, "Odrzucono zgł."),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function FilterChips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            o.value === value
              ? "border-foreground/20 bg-foreground text-background"
              : "border-border bg-background text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type HistoryFilter = "all" | "comment" | "description";
const HISTORY_FILTER_LABELS: Record<HistoryFilter, string> = {
  all: "Wszystkie",
  comment: "Komentarze",
  description: "Opisy",
};

function HistoryTab() {
  const [rows, setRows] = useState<LogItem[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  useEffect(() => {
    return watchHistory(
      (items) => { setHistoryErr(null); setRows(items); },
      () => { setHistoryErr("Nie udało się wczytać historii — sprawdź połączenie i odśwież."); setRows([]); },
    );
  }, []);

  if (rows === null) return <Empty text="Ładowanie…" />;

  const visible = rows.filter((r) => filter === "all" || r.targetType === filter);

  return (
    <div className="space-y-3">
      <FilterChips<HistoryFilter>
        value={filter}
        onChange={setFilter}
        options={Object.entries(HISTORY_FILTER_LABELS).map(([v, label]) => ({ value: v as HistoryFilter, label }))}
      />
      <Section title="Historia decyzji" count={visible.length}>
        {historyErr ? (
          <QueueError message={historyErr} />
        ) : visible.length === 0 ? (
          <Empty text="Brak wpisów w historii decyzji." />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Typ</TableHead>
                <TableHead>Treść</TableHead>
                <TableHead className="w-32">AI</TableHead>
                <TableHead className="w-32">Człowiek</TableHead>
                <TableHead className="w-24">Override</TableHead>
                <TableHead className="w-36">Kiedy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {r.targetType === "comment" ? "Komentarz" : r.targetType === "description" ? "Opis" : r.targetType}
                      </span>
                      {r.isTest && <TestBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <p className="line-clamp-3">{r.text || "—"}</p>
                  </TableCell>
                  <TableCell className="align-top">
                    {r.ai ? <StateBadge state={r.ai.state} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    {r.human ? <StateBadge state={r.human.state} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    {r.overrodeAI ? <Badge variant="destructive">override</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

type ContentFilter = "comments" | "descs";

function ContentTab() {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [descs, setDescs] = useState<DescriptionItem[] | null>(null);
  const [filter, setFilter] = useState<ContentFilter>("comments");
  const load = useCallback(() => {
    fetchAllComments().then(setComments).catch(() => toast.error("Błąd komentarzy."));
    fetchAllDescriptions().then(setDescs).catch(() => toast.error("Błąd opisów."));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <FilterChips<ContentFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: "comments", label: `Komentarze (${comments?.length ?? "…"})` },
          { value: "descs",    label: `Opisy (${descs?.length ?? "…"})` },
        ]}
      />
      {filter === "comments" && (!comments ? (
          <Empty text="Ładowanie…" />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Autor</TableHead>
                  <TableHead>Treść</TableHead>
                  <TableHead className="w-28">Stan</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-12 text-right">Akcje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comments.map((c) => (
                  <TableRow key={`${c.pointId}/${c.commentId}`}>
                    <TableCell className="align-top text-sm">
                      <div className="flex flex-col gap-1">
                        <span className="break-words">{c.authorName || "Użytkownik"}</span>
                        {c.isTest && <TestBadge />}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <p className="line-clamp-3">{c.text}</p>
                    </TableCell>
                    <TableCell className="align-top"><StateBadge state={c.state} /></TableCell>
                    <TableCell className="align-top"><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="align-top text-right">
                      <KebabMenu
                        actions={[
                          ...(c.state !== "approved"
                            ? [{ label: "Zatwierdź", onClick: () => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Zatwierdzono", load) }]
                            : []),
                          ...(c.status !== "removed"
                            ? [{
                                label: "Odrzuć",
                                variant: "destructive" as const,
                                onClick: () => confirmReject("komentarz") && act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Odrzucono", load),
                              }]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      {filter === "descs" && (!descs ? (
          <Empty text="Ładowanie…" />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Punkt</TableHead>
                  <TableHead>Opis</TableHead>
                  <TableHead className="w-28">Stan</TableHead>
                  <TableHead className="w-12 text-right">Akcje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {descs.map((p) => (
                  <TableRow key={p.pointId}>
                    <TableCell className="align-top text-sm font-medium">
                      <span className="break-words">{p.name || p.pointId}</span>
                      <PointProps p={p} />
                      {p.isTest && <div className="mt-1"><TestBadge /></div>}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <p className="line-clamp-4">{p.description}</p>
                    </TableCell>
                    <TableCell className="align-top"><StateBadge state={p.state} /></TableCell>
                    <TableCell className="align-top text-right">
                      <KebabMenu
                        actions={[
                          ...(p.state !== "approved"
                            ? [{ label: "Zatwierdź", onClick: () => act({ action: "approveDescription", pointId: p.pointId }, "Zatwierdzono", load) }]
                            : []),
                          ...(p.state !== "rejected"
                            ? [{ label: "Odrzuć", variant: "destructive" as const, onClick: () => confirmReject("opis") && act({ action: "rejectDescription", pointId: p.pointId }, "Odrzucono", load) }]
                            : []),
                          ...(mapLink(p.lat, p.lon)
                            ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
    </div>
  );
}
