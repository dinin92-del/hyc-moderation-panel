"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, ExternalLink, Droplets, Flame, Moon, TriangleAlert, ChevronDown, ChevronRight, Check, EyeOff, Pencil, Plus, RotateCw } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { EnvSwitch, EnvBanner } from "@/components/env-switch";
import { StateBadge, StatusBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  decide,
  setUserBlock,
  unblockUser,
  deletePoint,
  editPoint,
  createPoint,
  type PointCreateFields,
  type PointEditFields,
  fetchAllComments,
  fetchContentPoints,
  fetchAllReports,
  fetchPointsByIds,
  fetchUserNames,
  descriptionContributor,
  descriptionDate,
  fetchCommentById,
  fetchDescriptionById,
  fetchLogFor,
  fetchPhotosForPoint,
  moderatorDeletePhoto,
  type PhotoItem,
  watchCommentsQueue,
  watchDescriptionsQueue,
  watchReportsQueue,
  watchBlockedUsers,
  QUEUE_LIMIT,
  BROWSE_LIMIT,
  type CommentItem,
  type DescriptionItem,
  type LogItem,
  type ReportItem,
  type BlockedItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, aiLabel, fmtDate } from "@/lib/labels";
import { formatPhoneDisplay } from "@/lib/phone";

export default function Home() {
  // Provider WEWNĄTRZ AuthGate — subskrypcja blokad startuje dopiero po
  // zalogowaniu moderatora (przed nim Firestore i tak odrzuci odczyt).
  return (
    <AuthGate>
      {({ user, signOut }) => (
        <BlockedProvider>
          <Panel email={user.email ?? ""} signOut={signOut} />
        </BlockedProvider>
      )}
    </AuthGate>
  );
}

// Lock PER-CEL (nie globalny): różne wiersze działają równolegle, ta sama akcja
// na tym samym celu jest deduplikowana (double-click / szybki retry).
const inFlight = new Set<string>();
function actKey(input: Parameters<typeof decide>[0]): string {
  if (input.action === "closeReport") return `report:${input.reportId}`;
  return `${input.action}:${input.pointId ?? ""}/${input.commentId ?? ""}`;
}

async function act(input: Parameters<typeof decide>[0], okMsg: string, after?: () => void) {
  const key = actKey(input);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await decide(input);
    toast.success(okMsg);
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    inFlight.delete(key);
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
  const key = `block:${targetUid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await setUserBlock(targetUid, true);
    toast.success("Autor zablokowany");
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    inFlight.delete(key);
  }
}

// Twarde usunięcie punktu — osobny callable (onModeratorDeletePoint), z twardym
// potwierdzeniem. Kasuje punkt z bazy + komentarze; znika z mapy wszystkim.
async function actDeletePoint(pointId: string, pointName: string, after?: () => void) {
  if (
    !window.confirm(
      `Usunąć punkt „${pointName || pointId}" NA STAŁE? Zniknie z bazy i z mapy ` +
        "(wszystkim), razem z komentarzami. Operacja nieodwracalna.",
    )
  )
    return;
  const key = `deletePoint:${pointId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await deletePoint(pointId);
    toast.success("Punkt usunięty");
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    inFlight.delete(key);
  }
}

// Odblokowanie autora z listy „Zablokowani".
async function actUnblock(targetUid: string, after?: () => void) {
  if (!window.confirm("Odblokować tego autora? Znów będzie mógł dodawać treści.")) return;
  const key = `unblock:${targetUid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await unblockUser(targetUid);
    toast.success("Autor odblokowany");
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    inFlight.delete(key);
  }
}

function mapLink(lat: number | null, lon: number | null): string | undefined {
  if (lat === null || lon === null) return undefined;
  return `https://mapy.cz/turisticka?x=${lon}&y=${lat}&z=16`;
}

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
const useBlocked = () => useContext(BlockedContext);

function BlockedProvider({ children }: { children: React.ReactNode }) {
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
  const [addOpen, setAddOpen] = useState(false);

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
          {/* „Dodaj punkt" to AKCJA, nie widok — przycisk przy tabach, nie tab. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="queue">Kolejka ({queueTotal})</TabsTrigger>
              <TabsTrigger value="content">Wszystkie treści</TabsTrigger>
              <TabsTrigger value="blocked">Zablokowani</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              className="gap-1 bg-green-600 text-white hover:bg-green-700"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Dodaj punkt
            </Button>
          </div>

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

          <TabsContent value="content" className="pt-4">
            <ContentTab />
          </TabsContent>

          <TabsContent value="blocked" className="pt-4">
            <BlockedTab />
          </TabsContent>
        </Tabs>
      </main>

      <AddPointDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

// AKTUALNA taksonomia (lustro `ShelterType` w lib/core/models/shelter.dart —
// kolejność = priorytet enuma). To jedyne kody, które wolno WYBRAĆ przy dodawaniu
// i edycji; backend odrzuca resztę (whitelist w applyModeratorCreatePoint).
const TAXONOMY_OPTIONS: Array<[code: string, label: string]> = [
  ["schronisko", "Schronisko"],
  ["nocleg", "Nocleg"],
  ["bacowka", "Bacówka"],
  ["sklep", "Sklep"],
  ["stanica", "Stanica"],
  ["baza_namiotowa", "Baza namiotowa"],
  ["chatka", "Chatka"],
  ["restauracja", "Gastronomia"],
  ["obserwacyjne", "Obserwacyjne"],
  ["schronienie_skalne", "Schronienie skalne"],
  ["opuszczone", "Opuszczony obiekt"],
  ["miejsce_biwakowe", "Baza biwakowa"],
  ["wiata", "Wiata"],
  ["schronienie", "Schronienie"],
  ["przystanek", "Wiata przystankowa"],
  ["nieznane", "Typ nieznany"],
];

// Etykiety do WYŚWIETLANIA — taksonomia aktualna + kody wycofane, które mogą
// jeszcze siedzieć w starych dokumentach (alias `dom_turysty`, kategorie usunięte
// 07/2026). Wycofanych NIE ma w [TAXONOMY_OPTIONS], więc nie da się ich wybrać.
const SHELTER_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(TAXONOMY_OPTIONS),
  dom_turysty: "Nocleg",
  parking_zadaszony: "Zadaszony parking (wycofane)",
  wiata_rowerowa: "Wiata rowerowa (wycofane)",
  altana: "Altana (wycofane)",
  daszek: "Daszek (wycofane)",
  pasnik: "Paśnik (wycofane)",
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

// Etykiety werdyktu AI (moderation.labels[]) — czemu item trafił do needs_review.
function LabelChips({ labels }: { labels: string[] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {labels.map((l) => (
        <span
          key={l}
          className="inline-flex items-center rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700"
        >
          AI: {aiLabel(l)}
        </span>
      ))}
    </div>
  );
}

// Ostrzeżenie o ucięciu listy (osiągnięto twardy limit zapytania).
function TruncNote({ shown }: { shown: number }) {
  if (shown < QUEUE_LIMIT) return null;
  return (
    <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-700">
      ⚠ Pokazano pierwsze {QUEUE_LIMIT} — lista może być dłuższa. Przejrzyj i odśwież, żeby zobaczyć resztę.
    </div>
  );
}

function Section({ title, count, children, truncated }: { title: string; count: number; children: React.ReactNode; truncated?: number }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title} <span className="font-mono">({count})</span>
      </h2>
      <div className="overflow-hidden rounded-lg border bg-background">
        {children}
        {truncated != null && <TruncNote shown={truncated} />}
      </div>
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

function confirmHide(what: string) {
  return window.confirm(`Ukryć ${what}? Nie będzie widoczny w aplikacji.`);
}

type KebabAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "destructive";
};

// Decyzja moderacyjna widoczna w wierszu (1 klik), nazwana SKUTKIEM —
// „Opublikuj"/„Ukryj" tłumaczą się same, bez legend i tooltipów z esejem.
// Ten sam komponent na każdej powierzchni (kolejki, zgłoszenia, przeglądarka);
// przycisk renderuje się tylko, gdy akcja ma sens w bieżącym stanie treści.
function PublishHideButtons({ onPublish, onHide }: { onPublish?: () => void; onHide?: () => void }) {
  if (!onPublish && !onHide) return null;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {onPublish && (
        <Button
          size="sm"
          variant="outline"
          title="Treść będzie widoczna w aplikacji"
          onClick={onPublish}
          className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500 dark:hover:text-green-400"
        >
          <Check className="h-3.5 w-3.5" />
          Opublikuj
        </Button>
      )}
      {onHide && (
        <Button
          size="sm"
          variant="outline"
          title="Treść zniknie z aplikacji"
          onClick={onHide}
          className="h-7 gap-1 border-red-600/40 px-2 text-red-700 hover:border-red-600 hover:bg-red-600/10 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Ukryj
        </Button>
      )}
    </div>
  );
}

function KebabMenu({ actions, header }: { actions: KebabAction[]; header?: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none">
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Akcje</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {header && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-64 text-xs font-normal whitespace-normal text-muted-foreground">
                {header}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
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
  const { uids: blocked } = useBlocked();
  return (
    <Section title="Komentarze do sprawdzenia" count={visible.length} truncated={items.length}>
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
              <TableHead className="w-60 text-right">Akcje</TableHead>
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
                    <LabelChips labels={c.labels} />
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
                  <div className="flex items-center justify-end gap-1">
                    <PublishHideButtons
                      onPublish={() => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Opublikowano")}
                      onHide={() =>
                        confirmHide("komentarz") &&
                        act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Ukryto")
                      }
                    />
                    <KebabMenu actions={blockActions(c.authorUid, c.authorName, blocked)} />
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

// Podgląd numeru w kształcie, w jakim wyrenderuje go apka. Pole zostaje SUROWE —
// panel niczego nie przepisuje w bazie, bo numer pochodzi ze źródła (OSM, rejestr)
// i przepisanie go przy każdej edycji punktu zacierałoby ten zapis. Reguła formatu
// jest kopią `lib/core/models/phone_number.dart` z apki — patrz `@/lib/phone`.
function PhonePreview({ value }: { value: string }) {
  const trimmed = value.trim();
  // ⛔ Wpis bez ani jednej cyfry NIE dojdzie do apki: serwerowy `sanitizePhone`
  // rzuca, a apkowy `normalizePhone` zwraca null i wiersz telefonu w ogóle się nie
  // renderuje. Podgląd musi wtedy MILCZEĆ — pokazanie „W apce: ---" obiecywałoby
  // moderatorowi ekran, którego nigdy nie będzie.
  if (!trimmed || !/\d/.test(trimmed)) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      W apce:{" "}
      <span className="font-medium text-foreground">{formatPhoneDisplay(trimmed)}</span>
    </span>
  );
}

// Inline formularz kuratorskiej edycji punktu (rozwijany pod wierszem). Wysyła
// tylko ZMIENIONE pola (callable wymaga ≥1). Zmiana nazwy/opisu → serwer zapisuje
// approved + contentHash (bez re-moderacji). Bez nowej zależności (Input/Select/
// natywne checkboxy + textarea).
function PointEditForm({ point, onDone, onSaved }: { point: DescriptionItem; onDone: () => void; onSaved?: () => void }) {
  const [name, setName] = useState(point.name ?? "");
  const [description, setDescription] = useState(point.description ?? "");
  const [type, setType] = useState(point.type ?? "");
  const [lat, setLat] = useState(point.lat?.toString() ?? "");
  const [lon, setLon] = useState(point.lon?.toString() ?? "");
  const [waterNearby, setWaterNearby] = useState(point.waterNearby);
  const [fireSpot, setFireSpot] = useState(point.fireSpot);
  const [overnight, setOvernight] = useState(point.overnight);
  const [emergencyShelter, setEmergencyShelter] = useState(point.emergencyShelter);
  const [phone, setPhone] = useState(point.phone ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const fields: PointEditFields = {};
    if (name.trim() !== (point.name ?? "")) fields.name = name.trim() || null;
    if (description.trim() !== (point.description ?? "")) {
      fields.description = description.trim() || null;
    }
    if (type !== point.type) fields.type = type;
    if (lat.trim() !== "" && Number(lat) !== point.lat) {
      const v = Number(lat);
      if (!Number.isFinite(v)) return toast.error("Szerokość: nieprawidłowa liczba");
      fields.lat = v;
    }
    if (lon.trim() !== "" && Number(lon) !== point.lon) {
      const v = Number(lon);
      if (!Number.isFinite(v)) return toast.error("Długość: nieprawidłowa liczba");
      fields.lon = v;
    }
    if (waterNearby !== point.waterNearby) fields.waterNearby = waterNearby;
    if (fireSpot !== point.fireSpot) fields.fireSpot = fireSpot;
    if (overnight !== point.overnight) fields.overnight = overnight;
    if (emergencyShelter !== point.emergencyShelter) {
      fields.emergencyShelter = emergencyShelter;
    }
    // Pusty input = czyszczenie numeru (null w dokumencie). Format waliduje
    // callable (sanitizePhone) — panel nie duplikuje reguł.
    if (phone.trim() !== (point.phone ?? "")) fields.phone = phone.trim() || null;
    if (Object.keys(fields).length === 0) return toast("Brak zmian do zapisania");
    setSaving(true);
    try {
      await editPoint(point.pointId, fields);
      toast.success("Punkt zaktualizowany");
      onSaved?.();
      onDone();
    } catch (e) {
      toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
    } finally {
      setSaving(false);
    }
  }

  const flag = (
    label: string,
    checked: boolean,
    set: (v: boolean) => void,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Nazwa</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Kategoria</span>
          <Select value={type} onValueChange={(v) => setType(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
            <SelectContent>
              {TAXONOMY_OPTIONS.map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Opis</span>
        <textarea
          className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Szerokość (lat)</span>
          <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Długość (lon)</span>
          <Input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
        </label>
      </div>
      <label className="block space-y-1 text-sm sm:max-w-xs">
        <span className="text-muted-foreground">Telefon (opcjonalny)</span>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="+48 902 092 012"
        />
        <PhonePreview value={phone} />
      </label>
      <div className="flex flex-wrap gap-4">
        {flag("Woda w pobliżu", waterNearby, setWaterNearby)}
        {flag("Miejsce na ogień", fireSpot, setFireSpot)}
        {flag("Nocleg", overnight, setOvernight)}
        {flag("Schronienie awaryjne", emergencyShelter, setEmergencyShelter)}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz zmiany"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>Anuluj</Button>
      </div>
    </div>
  );
}

// Edycja punktu zawsze w modalu (decyzja UX 0721) — bez rozwijania wierszy
// tabeli; Esc/backdrop/Anuluj zamykają bez zapisu.
function PointEditDialog({ point, onClose, onSaved }: { point: DescriptionItem | null; onClose: () => void; onSaved?: () => void }) {
  return (
    <Dialog open={point !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {point && (
        <DialogContent>
          <DialogTitle>Edytuj punkt — {point.name || point.pointId}</DialogTitle>
          <PointEditForm point={point} onDone={onClose} onSaved={onSaved} />
        </DialogContent>
      )}
    </Dialog>
  );
}

// ── Ręczne dodawanie punktu ──────────────────────────────────────────────────

/** Bounding box PL + pas 50 km (zasięg danych). Poza nim = ostrzeżenie, nie blokada. */
const PL_BBOX = { latMin: 48.4, latMax: 55.5, lonMin: 13.3, lonMax: 25.0 };

function toNumber(v: string): number {
  // „49,412" (przecinek dziesiętny) i „49.412," (ogon po wklejeniu pary).
  return Number(v.trim().replace(/,$/, "").replace(",", "."));
}

/**
 * Wyłuskuje parę współrzędnych z jednego wklejenia: „49.412, 20.712",
 * „49,412 20,712", link Google Maps (`@lat,lon` / `?q=lat,lon`) albo mapy.cz
 * (`x=lon&y=lat`). Zwraca null, gdy nie da się odczytać pary liczb.
 */
function parseLatLon(raw: string): { lat: number; lon: number } | null {
  const s = raw.trim();
  if (!s) return null;
  const g = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (g) return { lat: Number(g[1]), lon: Number(g[2]) };
  const mx = s.match(/[?&]x=(-?\d+\.\d+)/);
  const my = s.match(/[?&]y=(-?\d+\.\d+)/);
  if (mx && my) return { lat: Number(my[1]), lon: Number(mx[1]) }; // mapy.cz: x=lon, y=lat
  const parts = /[\s;]/.test(s) ? s.split(/[\s;]+/) : s.split(",");
  if (parts.length !== 2) return null;
  const lat = toNumber(parts[0]);
  const lon = toNumber(parts[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * Formularz ręcznego dodania punktu (nazwa/kategoria/współrzędne/opis/flagi) —
 * w modalu pod przyciskiem „Dodaj punkt" przy tabach. Punkt idzie przez callable
 * `onModeratorCreatePoint` i jest widoczny w apce od razu (UGC, approved) — bez
 * czekania na moderację i bez wydania nowej wersji. Formularz po zapisie czyści
 * treść, ale ZOSTAWIA kategorię i flagi (modal zostaje otwarty): wpisywanie
 * serii punktów tego samego typu to główny scenariusz (import z listy adresów).
 * Dodane punkty widać w „Wszystkie treści" jako „Nowy punkt".
 */
function AddPointForm() {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [description, setDescription] = useState("");
  const [waterNearby, setWaterNearby] = useState(false);
  const [fireSpot, setFireSpot] = useState(false);
  const [overnight, setOvernight] = useState(false);
  const [emergencyShelter, setEmergencyShelter] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // Wklejenie pary („49.412, 20.712" lub link z mapy) w pole szerokości rozbija
  // się na oba pola — przy przepisywaniu z listy to najczęstszy ruch.
  function onLatPaste(text: string) {
    const parsed = parseLatLon(text);
    if (!parsed) return false;
    setLat(String(parsed.lat));
    setLon(String(parsed.lon));
    return true;
  }

  const latNum = toNumber(lat);
  const lonNum = toNumber(lon);
  const coordsOk =
    lat.trim() !== "" && lon.trim() !== "" &&
    Number.isFinite(latNum) && Number.isFinite(lonNum) &&
    latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
  const outsidePl = coordsOk && (
    latNum < PL_BBOX.latMin || latNum > PL_BBOX.latMax ||
    lonNum < PL_BBOX.lonMin || lonNum > PL_BBOX.lonMax
  );
  const canSubmit = name.trim() !== "" && type !== "" && coordsOk && !saving;

  async function submit() {
    if (!canSubmit) return;
    const fields: PointCreateFields = {
      name: name.trim(),
      type,
      lat: latNum,
      lon: lonNum,
      waterNearby,
      fireSpot,
      overnight,
      emergencyShelter,
    };
    if (description.trim() !== "") fields.description = description.trim();
    if (phone.trim() !== "") fields.phone = phone.trim();
    setSaving(true);
    try {
      await createPoint(fields);
      toast.success("Punkt dodany — widoczny w apce");
      // Treść czyścimy, kategorię/flagi zostawiamy pod kolejny punkt z serii.
      // Telefon też czyścimy — numer jest per-punkt, nie per-seria.
      setName("");
      setLat("");
      setLon("");
      setDescription("");
      setPhone("");
    } catch (e) {
      toast.error("Nie udało się dodać: " + (e instanceof Error ? e.message : "błąd"));
    } finally {
      setSaving(false);
    }
  }

  const flag = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div>
        <p className="mb-3 text-xs text-muted-foreground">
          Punkt trafia do bazy jako wpis moderatora (podpis „Zespół Hyc!”) i jest widoczny
          w aplikacji od razu — bez kolejki moderacji. Opis jest opcjonalny; bez niego apka
          pokaże przy punkcie zaproszenie „Zostań pionierem”.
        </p>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Nazwa *</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="np. Bacówka nad Wierchomlą"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Kategoria *</span>
              <Select value={type} onValueChange={(v) => setType(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Wybierz kategorię" /></SelectTrigger>
                <SelectContent>
                  {TAXONOMY_OPTIONS.map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Szerokość (lat) *</span>
              <Input
                value={lat}
                inputMode="decimal"
                placeholder="49.412 — można wkleić parę albo link z mapy"
                onChange={(e) => { if (!onLatPaste(e.target.value)) setLat(e.target.value); }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Długość (lon) *</span>
              <Input
                value={lon}
                inputMode="decimal"
                placeholder="20.712"
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
          </div>
          {lat.trim() !== "" && lon.trim() !== "" && !coordsOk && (
            <p className="text-xs text-red-600">Współrzędne nieprawidłowe — sprawdź liczby.</p>
          )}
          {outsidePl && (
            <p className="text-xs text-amber-600">
              Uwaga: punkt leży poza Polską i pasem 50 km — czy szerokość z długością nie są
              zamienione miejscami?
            </p>
          )}
          {coordsOk && (
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
              href={mapLink(latNum, lonNum)}
              target="_blank"
              rel="noreferrer"
            >
              Sprawdź na mapie <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Opis (opcjonalny)</span>
            <textarea
              className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Co user zastanie na miejscu"
            />
          </label>

          <label className="block space-y-1 text-sm sm:max-w-xs">
            <span className="text-muted-foreground">Telefon (opcjonalny)</span>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+48 902 092 012"
            />
            <PhonePreview value={phone} />
          </label>

          <div className="flex flex-wrap gap-4">
            {flag("Woda w pobliżu", waterNearby, setWaterNearby)}
            {flag("Miejsce na ogień", fireSpot, setFireSpot)}
            {flag("Nocleg", overnight, setOvernight)}
            {flag("Schronienie awaryjne", emergencyShelter, setEmergencyShelter)}
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={submit} disabled={!canSubmit}>
              {saving ? "Dodawanie…" : "Dodaj punkt"}
            </Button>
            <span className="text-xs text-muted-foreground">* pola wymagane</span>
          </div>
        </div>
    </div>
  );
}

// Modal „Dodaj punkt" — zostaje otwarty po zapisie (seria punktów); Esc/backdrop
// zamykają. Stan formularza żyje w AddPointForm, więc zamknięcie modala go zeruje.
function AddPointDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {open && (
        <DialogContent>
          <DialogTitle>Nowy punkt</DialogTitle>
          <AddPointForm />
        </DialogContent>
      )}
    </Dialog>
  );
}

function QueueDescriptions({ items, error, hideTest }: { items: DescriptionItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((p) => !p.isTest) : items;
  const [editingId, setEditingId] = useState<string | null>(null);
  const { uids: blocked } = useBlocked();
  return (
    <Section title="Opisy do sprawdzenia" count={visible.length} truncated={items.length}>
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
              <TableHead className="w-60 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p.pointId}>
                <TableCell className="align-top text-sm font-medium">
                  <span className="break-words">{p.name || p.pointId}</span>
                  <PointProps p={p} />
                  <LabelChips labels={p.labels} />
                  {p.isTest && <div className="mt-1"><TestBadge /></div>}
                </TableCell>
                <TableCell className="align-top text-sm">
                  <p className="whitespace-pre-wrap break-words">{p.description}</p>
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(descriptionDate(p))}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PublishHideButtons
                      onPublish={() => act({ action: "approveDescription", pointId: p.pointId }, "Opublikowano")}
                      onHide={() =>
                        confirmHide("opis") && act({ action: "rejectDescription", pointId: p.pointId }, "Ukryto")
                      }
                    />
                    <KebabMenu
                      actions={[
                        {
                          label: "Edytuj punkt",
                          onClick: () => setEditingId(p.pointId),
                        },
                        // Kolejka opisów moderuje OPIS, więc blokada celuje w jego
                        // autora (#615), nie w twórcę punktu. Przy nieznanej
                        // atrybucji `descriptionContributor` zwraca null / uid null
                        // — wtedy akcji NIE MA w ogóle, żeby nie zablokować
                        // niewinnego twórcy punktu za cudzy opis.
                        ...(() => {
                          const a = descriptionContributor(p);
                          if (!a?.uid) return [];
                          // Doprecyzowanie „opisu" tylko wtedy, gdy w wierszu są DWIE
                          // osoby — inaczej etykieta sugerowałaby drugiego autora tam,
                          // gdzie jest jeden.
                          const label = a.uid === p.authorUid ? undefined : `Zablokuj autora opisu (${a.name})`;
                          return blockActions(a.uid, a.name, blocked, undefined, label);
                        })(),
                        {
                          label: "Usuń punkt",
                          variant: "destructive",
                          onClick: () => actDeletePoint(p.pointId, p.name),
                        },
                        ...(mapLink(p.lat, p.lon)
                          ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }]
                          : []),
                      ]}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PointEditDialog
        point={visible.find((p) => p.pointId === editingId) ?? null}
        onClose={() => setEditingId(null)}
      />
    </Section>
  );
}

function QueueReports({ items, error, hideTest }: { items: ReportItem[]; error: string | null; hideTest: boolean }) {
  const visible = hideTest ? items.filter((r) => !r.isTest) : items;
  return (
    <Section title="Zgłoszenia użytkowników" count={visible.length} truncated={items.length}>
      {error ? (
        <QueueError message={error} />
      ) : visible.length === 0 ? (
        <Empty text="Brak otwartych zgłoszeń." />
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-24">Cel</TableHead>
              <TableHead className="w-40">Przyczyna</TableHead>
              <TableHead>Powód (tekst)</TableHead>
              <TableHead className="w-96 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

// Odrzucenie zgłoszenia jako niezasadne (treść zostaje bez zmian). Wydzielone,
// bo używane i przy istniejącym celu, i gdy cel skasowany (report i tak da się domknąć).
function dismissReport(r: ReportItem) {
  act({ action: "closeReport", reportId: r.id, resolution: "dismissed" }, "Zgłoszenie odrzucone (niezasadne)");
}

// Wiersz zgłoszenia z rozwijanym PODGLĄDEM zgłoszonej treści (resolve celu po id)
// + akcjami NA CEL (zatwierdź/odrzuć), obok zamknięcia samego zgłoszenia.
function ReportRow({ r }: { r: ReportItem }) {
  // Wiersz startuje ZWINIĘTY — chevron rozwija sam PODGLĄD treści. Akcje są w linii
  // wiersza (kolumna Akcje), więc nie wymagają rozwijania.
  const [open, setOpen] = useState(false);
  // undefined = jeszcze nie pobrano (ładowanie), null = celu nie znaleziono, obiekt = cel.
  const [target, setTarget] = useState<CommentItem | DescriptionItem | null | undefined>(undefined);
  const isComment = r.target === "comment";
  const reason = r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";

  // Eager-load celu w TLE (mimo że wiersz zwinięty) — akcje w wierszu potrzebują
  // danych celu. setState w callbacku promisy — poza synchronicznym ciałem efektu.
  useEffect(() => {
    let alive = true;
    const p = isComment && r.commentId
      ? fetchCommentById(r.pointId, r.commentId)
      : fetchDescriptionById(r.pointId);
    p.then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null));
    return () => {
      alive = false;
    };
  }, [isComment, r.commentId, r.pointId]);

  // Cel jest już w stanie — chevron tylko pokazuje/chowa, bez ponownego fetcha.
  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={toggle}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            title="Podgląd zgłoszonej treści"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col gap-1">
            <Badge variant="outline">{TARGET_LABEL[r.target] ?? r.target}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground break-all">
              {r.pointId}
              {r.commentId ? `/${r.commentId}` : ""}
            </span>
          </div>
        </TableCell>
        <TableCell className="align-top text-sm">{reason}</TableCell>
        <TableCell className="align-top text-sm text-muted-foreground">
          <p className="whitespace-pre-wrap break-words">{r.reason || "—"}</p>
        </TableCell>
        <TableCell className="align-top">
          <ReportActions r={r} target={target} isComment={isComment} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="py-1">
              {target === undefined ? (
                <span className="text-xs text-muted-foreground">Ładowanie treści…</span>
              ) : target === null ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                <ReportPreview target={target} isComment={isComment} />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Akcje zgłoszenia — renderowane W LINII wiersza (kolumna Akcje), nie w rozwinięciu.
// Działają na doładowanym w tle `target`. Główne akcje widoczne, reszta pod kebabem,
// zestaw zależny od typu celu. Każda akcja na treści AUTO-ZAMYKA zgłoszenie (actioned);
// „Odrzuć zgłoszenie" (dismissed) działa zawsze, także zanim cel się doładuje.
function ReportActions({ r, target, isComment }: { r: ReportItem; target: CommentItem | DescriptionItem | null | undefined; isComment: boolean }) {
  const [editing, setEditing] = useState(false);
  const { uids: blocked } = useBlocked();
  const c = target && isComment ? (target as CommentItem) : null;
  const p = target && !isComment ? (target as DescriptionItem) : null;
  const hidden = target?.state === "rejected"; // ukryty w aplikacji

  // Po skutecznej akcji na treści zamykamy też zgłoszenie — znika z kolejki.
  const closeActioned = () =>
    act({ action: "closeReport", reportId: r.id, resolution: "actioned" }, "Zgłoszenie zamknięte");

  // Kebab = akcje drugorzędne, zależne od typu celu (pusty, gdy cel się nie doładował).
  const kebab: KebabAction[] = c
    ? blockActions(c.authorUid, c.authorName, blocked)
    : p
      ? [
          {
            label: "Usuń punkt",
            variant: "destructive",
            onClick: () => actDeletePoint(r.pointId, p.name ?? "", closeActioned),
          },
          hidden
            ? {
                label: "Opublikuj opis",
                onClick: () => act({ action: "approveDescription", pointId: r.pointId }, "Opis opublikowany", closeActioned),
              }
            : {
                label: "Ukryj opis",
                onClick: () => {
                  if (confirmHide("opis")) act({ action: "rejectDescription", pointId: r.pointId }, "Opis ukryty", closeActioned);
                },
              },
          ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
        ]
      : [];

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {c ? (
        hidden ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
            onClick={() =>
              act({ action: "approveComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz opublikowany", closeActioned)
            }
          >
            <Check className="h-3.5 w-3.5" />
            Opublikuj komentarz
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
            onClick={() => {
              if (window.confirm("Usunąć komentarz? Zniknie z aplikacji (można przywrócić przez „Opublikuj komentarz”)."))
                act({ action: "rejectComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz usunięty", closeActioned);
            }}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Usuń komentarz
          </Button>
        )
      ) : p ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-green-600/40 px-2 text-green-700 hover:border-green-600 hover:bg-green-600/10 hover:text-green-800 dark:text-green-500"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edytuj punkt
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        title="Zgłoszenie bez podstaw — treść zostaje bez zmian"
        onClick={() => dismissReport(r)}
      >
        Odrzuć zgłoszenie
      </Button>
      <KebabMenu actions={kebab} />
      {p && <PointEditDialog point={editing ? p : null} onClose={() => setEditing(false)} onSaved={closeActioned} />}
    </div>
  );
}

/**
 * Zdjęcia punktu w podglądzie — moderacja zdjęć (wymóg sklepów: moderator musi
 * móc zdjąć cudze zdjęcie; callable photoModeratorDelete). Ładowane dopiero
 * przy ROZWINIĘCIU podglądu, nie per wiersz listy. Usunięte pokazujemy tylko
 * liczbą (wgląd bez szumu); punkt bez zdjęć nie renderuje sekcji wcale.
 */
function PointPhotos({ pointId }: { pointId: string }) {
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

// Podgląd zgłoszonej treści (rozwijany chevronem) — sam tekst, bez akcji.
function ReportPreview({ target, isComment }: { target: CommentItem | DescriptionItem; isComment: boolean }) {
  const c = isComment ? (target as CommentItem) : null;
  const p = !isComment ? (target as DescriptionItem) : null;
  return (
    <div className="min-w-0 text-sm">
      {c && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{c.authorName || "Użytkownik"}</span>
            <StateBadge state={c.state} />
          </div>
          <p className="whitespace-pre-wrap break-words">{c.text || "—"}</p>
        </>
      )}
      {p && (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">{p.name || p.pointId}</span>
            <StateBadge state={p.state} />
          </div>
          <PointProps p={p} />
          <p className="mt-1 whitespace-pre-wrap break-words">{p.description || "—"}</p>
          <PointPhotos pointId={p.pointId} />
        </>
      )}
    </div>
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

// Historia decyzji JEDNEJ treści — rozwijana chevronem w „Wszystkie treści"
// (zastąpiła globalną zakładkę „Historia decyzji": decyzję czyta się przy
// treści, której dotyczy, nie w oderwanym logu).
function HistoryPanel({ pointId, commentId }: { pointId: string; commentId: string | null }) {
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

function BlockedTab() {
  const { rows, error: err } = useBlocked();

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
              <TableHead>UID autora</TableHead>
              <TableHead className="w-56">Powód</TableHead>
              <TableHead className="w-36">Kiedy</TableHead>
              <TableHead className="w-12 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.uid}>
                <TableCell className="align-top font-mono text-xs break-all">{b.uid}</TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">
                  <p className="whitespace-pre-wrap break-words">{b.reason || "—"}</p>
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

// ── Wszystkie treści (scalone: nowe punkty / opisy / komentarze / zgłoszenia) ──

type ContentKind = "point" | "description" | "comment" | "report";
type ContentFilter = "all" | ContentKind;

const KIND_LABEL: Record<ContentKind, string> = {
  point: "Nowy punkt",
  description: "Opis",
  comment: "Komentarz",
  report: "Zgłoszenie",
};

// Kolor typu — rozróżnienie kategorii ma być widoczne w mieszanej liście
// („Wszystko") bez czytania etykiety.
const KIND_TONE: Record<ContentKind, string> = {
  point: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  description: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  comment: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  report: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
};

function KindBadge({ kind }: { kind: ContentKind }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${KIND_TONE[kind]}`}>
      {KIND_LABEL[kind]}
    </span>
  );
}

function ReportStatusBadge({ r }: { r: ReportItem }) {
  if (r.status === "open") {
    return <Badge className="border-transparent bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">Otwarte</Badge>;
  }
  const label = r.resolution === "dismissed" ? "Odrzucone" : "Załatwione";
  return <Badge className="border-transparent bg-muted font-normal text-muted-foreground">{label}</Badge>;
}

type ContentItem =
  | { kind: "point" | "description"; key: string; createdAt: number | null; isTest: boolean; p: DescriptionItem }
  | { kind: "comment"; key: string; createdAt: number | null; isTest: boolean; c: CommentItem }
  | { kind: "report"; key: string; createdAt: number | null; isTest: boolean; r: ReportItem };

// Edycja z poziomu wiersza; onSaved pozwala wierszowi zgłoszenia domknąć
// zgłoszenie po zapisie (parytet z kolejką).
type EditingPoint = { p: DescriptionItem; onSaved?: () => void };

const FILTER_ORDER: ContentFilter[] = ["all", "point", "description", "comment", "report"];
const FILTER_LABEL: Record<ContentFilter, string> = {
  all: "Wszystko",
  point: "Nowe punkty",
  description: "Opisy",
  comment: "Komentarze",
  report: "Zgłoszenia",
};

const PAGE_SIZE = 50;

function ContentTab() {
  const [content, setContent] = useState<{
    newPoints: DescriptionItem[];
    described: DescriptionItem[];
    truncated: boolean;
  } | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  // Rodzice komentarzy/zgłoszeń spoza pobranej strony punktów — TYLKO do nazwy
  // w tytule wiersza, nigdy jako osobna pozycja listy.
  const [parents, setParents] = useState<DescriptionItem[]>([]);
  // uid → displayName; zgłoszenie niesie sam uid zgłaszającego, komentarz/opis
  // starego usera bywa bez `authorName`.
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  // Id, o które PYTALIŚMY przy dociągu rodziców. Brak w `parents` po odpytaniu
  // znaczy „punktu nie ma w bazie" (usunięty) — i tylko wtedy wolno tak napisać;
  // bez tego zbioru nie odróżnisz usuniętego od jeszcze-nie-pobranego.
  const [probedIds, setProbedIds] = useState<Set<string>>(new Set());
  const { uids: blocked } = useBlocked();
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [search, setSearch] = useState("");
  const [hideTest, setHideTest] = useState(false);
  const [editing, setEditing] = useState<EditingPoint | null>(null);
  // Ile pobrać PER KOLEKCJA z serwera (rośnie „Załaduj więcej z serwera") vs
  // która strona po 50 pokazujemy z tego, co już mamy w pamięci (Poprzednia/
  // Następna) — dwa OSOBNE wymiary paginacji, nie mylić.
  const [fetchTake, setFetchTake] = useState(BROWSE_LIMIT);
  const [page, setPage] = useState(0);

  const load = useCallback((take: number) => {
    fetchContentPoints(take).then(setContent).catch(() => toast.error("Błąd punktów i opisów."));
    fetchAllComments(take).then(setComments).catch(() => toast.error("Błąd komentarzy."));
    fetchAllReports(take).then(setReports).catch(() => toast.error("Błąd zgłoszeń."));
  }, []);
  useEffect(() => { load(fetchTake); }, [load, fetchTake]);
  // Dociąg rodziców, których nie ma w pobranej stronie punktów — inaczej wiersz
  // komentarza/zgłoszenia pokazuje gołe id zamiast nazwy widocznej w aplikacji.
  useEffect(() => {
    if (!content || !comments || !reports) return;
    const have = new Set([...content.newPoints, ...content.described].map((p) => p.pointId));
    const missing = [...new Set([
      ...comments.map((c) => c.pointId),
      ...reports.map((r) => r.pointId),
    ])].filter((id) => id && !have.has(id));
    if (missing.length === 0) return;
    let alive = true;
    // Limit strażniczy: przy dużej kolejce nie robimy setek odczytów naraz.
    const asked = missing.slice(0, 200);
    fetchPointsByIds(asked)
      .then((ps) => {
        if (!alive) return;
        setParents(ps);
        setProbedIds(new Set(asked));
      })
      .catch(() => {/* tytuł spadnie na id — nie warto krzyczeć */});
    return () => { alive = false; };
  }, [content, comments, reports]);

  // Nazwy kont — dla zgłaszających (zgłoszenie ma sam uid) i dla treści bez
  // zapisanego `authorName`. Osobny efekt, bo lista uid zmienia się inaczej
  // niż lista punktów-rodziców.
  useEffect(() => {
    if (!content || !comments || !reports) return;
    const uids = new Set<string>();
    for (const r of reports) if (r.reporterUid) uids.add(r.reporterUid);
    for (const c of comments) if (c.authorUid && !c.authorName) uids.add(c.authorUid);
    for (const p of [...content.newPoints, ...content.described]) {
      if (p.authorUid && !p.authorName) uids.add(p.authorUid);
    }
    if (uids.size === 0) return;
    let alive = true;
    fetchUserNames([...uids].slice(0, 200))
      .then((m) => alive && setUserNames(m))
      .catch(() => {/* zostaje uid — nie warto krzyczeć */});
    return () => { alive = false; };
  }, [content, comments, reports]);

  if (!content || !comments || !reports) return <Empty text="Ładowanie…" />;

  // Rodzic dociągnięty wcześniej może w międzyczasie wejść do listy (np. po
  // „Załaduj więcej") — wtedy odpada, bo rekord z listy jest świeższy. Odsiew
  // przy budowie mapy, nie czyszczeniem stanu: `setState` w efekcie kaskaduje
  // render (react-hooks/set-state-in-effect), a tu wystarczy czysty filtr.
  const contentIds = new Set(
    [...content.newPoints, ...content.described].map((p) => p.pointId),
  );
  const pointById = new Map(
    [
      ...parents.filter((p) => !contentIds.has(p.pointId)),
      ...content.described,
      ...content.newPoints,
    ].map((p) => [p.pointId, p]),
  );

  const items: ContentItem[] = [
    ...content.newPoints.map((p): ContentItem => (
      { kind: "point", key: `point/${p.pointId}`, createdAt: p.createdAt, isTest: p.isTest, p })),
    // Wiersz opisu niesie datę OPISU — i jako wyświetlaną, i jako klucz sortu
    // niżej. `p.createdAt` (data punktu) kłamał w obu rolach — patrz
    // [descriptionDate].
    ...content.described.map((p): ContentItem => (
      { kind: "description", key: `desc/${p.pointId}`, createdAt: descriptionDate(p), isTest: p.isTest, p })),
    ...comments.map((c): ContentItem => (
      { kind: "comment", key: `comment/${c.pointId}/${c.commentId}`, createdAt: c.createdAt, isTest: c.isTest, c })),
    ...reports.map((r): ContentItem => (
      { kind: "report", key: `report/${r.id}`, createdAt: r.createdAt, isTest: r.isTest, r })),
  ].sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity));

  const needle = search.trim().toLowerCase();
  const haystack = (it: ContentItem): string => {
    switch (it.kind) {
      case "point":
      case "description":
        return `${it.p.name} ${it.p.pointId} ${it.p.authorName} ${it.p.description}`;
      case "comment":
        return `${pointById.get(it.c.pointId)?.name ?? ""} ${it.c.pointId} ${it.c.authorName} ${it.c.text}`;
      case "report":
        return `${pointById.get(it.r.pointId)?.name ?? ""} ${it.r.pointId} ${it.r.reason ?? ""}`;
    }
  };
  const visible = items
    .filter((it) => filter === "all" || it.kind === filter)
    .filter((it) => !hideTest || !it.isTest)
    .filter((it) => needle === "" || haystack(it).toLowerCase().includes(needle));

  const counts: Record<ContentFilter, number> = {
    all: items.length,
    point: items.filter((i) => i.kind === "point").length,
    description: items.filter((i) => i.kind === "description").length,
    comment: items.filter((i) => i.kind === "comment").length,
    report: items.filter((i) => i.kind === "report").length,
  };
  const truncated =
    content.truncated || comments.length >= fetchTake || reports.length >= fetchTake;
  const reload = () => load(fetchTake);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = visible.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Każda zmiana zawężenia wraca na 1. stronę — inaczej można wylądować
            na stronie, której po filtrze już nie ma. */}
        <FilterChips<ContentFilter>
          value={filter}
          onChange={(v) => { setFilter(v); setPage(0); }}
          options={FILTER_ORDER.map((v) => ({
            value: v,
            label: `${FILTER_LABEL[v]} (${counts[v]})`,
          }))}
        />
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-foreground"
              checked={hideTest}
              onChange={(e) => { setHideTest(e.target.checked); setPage(0); }}
            />
            Ukryj testowe
          </label>
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Szukaj: punkt, autor, treść…"
            className="h-8 w-64"
          />
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={reload} title="Odśwież listę">
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Section title="Wszystkie treści" count={visible.length}>
        {visible.length === 0 ? (
          <Empty text="Nic tu nie ma — zmień filtr albo wyszukiwanie." />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-28">Typ</TableHead>
                <TableHead className="w-36">Autor</TableHead>
                <TableHead>Treść</TableHead>
                <TableHead className="w-32">Stan</TableHead>
                <TableHead className="w-32">Data</TableHead>
                <TableHead className="w-12 text-right">Akcje</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((it) => (
                <ContentRow
                  key={it.key}
                  item={it}
                  pointById={pointById}
                  probedIds={probedIds}
                  userNames={userNames}
                  blocked={blocked}
                  onEdit={setEditing}
                  reload={reload}
                />
              ))}
            </TableBody>
          </Table>
        )}
        {visible.length > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              {clampedPage * PAGE_SIZE + 1}–{Math.min(visible.length, clampedPage * PAGE_SIZE + PAGE_SIZE)} z {visible.length}
            </span>
            <div className="flex items-center gap-2">
              {/* Kroki liczone od clampedPage, NIE od surowego `page` — po
                  skasowaniu treści lista się kurczy i `page` zostaje poza
                  zakresem; krok od `page` wyglądałby wtedy jak zacięty przycisk. */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={clampedPage === 0}
                onClick={() => setPage(Math.max(0, clampedPage - 1))}
              >
                Poprzednia
              </Button>
              <span>{clampedPage + 1} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setPage(Math.min(totalPages - 1, clampedPage + 1))}
              >
                Następna
              </Button>
            </div>
          </div>
        )}
        {truncated && (
          <div className="flex items-center justify-between gap-3 border-t bg-amber-50 px-4 py-2 text-xs text-amber-700">
            <span>⚠ Pobrano pierwsze {fetchTake} z każdej listy (punkty/opisy, komentarze, zgłoszenia) — może być więcej na serwerze.</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 border-amber-400 bg-transparent px-2 text-amber-800 hover:bg-amber-100"
              onClick={() => setFetchTake((t) => t + BROWSE_LIMIT)}
            >
              Załaduj więcej z serwera
            </Button>
          </div>
        )}
      </Section>

      <PointEditDialog
        point={editing?.p ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => { editing?.onSaved?.(); reload(); }}
      />
    </div>
  );
}

// Autor treści + status blokady. Blokada per WIERSZ (nie tylko lista
// „Zablokowani"), bo decyzję podejmuje się patrząc na treść.
// Nazwę podaje wywołujący (przez `nameOf`, z fallbackiem „Użytkownik" jak w
// aplikacji). uid trafia tu WYŁĄCZNIE do tooltipa — kolumna ma pokazywać
// człowieka, a nie identyfikator bazy; surowy uid był nieczytelny i mylił.
function AuthorCell({ name, uid, blocked }: { name: string; uid: string; blocked: boolean }) {
  return (
    <div className="flex flex-col gap-1" title={uid || undefined}>
      <span className="break-words">{name}</span>
      {blocked && (
        <span className="inline-flex w-fit items-center rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          zablokowany
        </span>
      )}
    </div>
  );
}

// Akcja blokady/odblokowania autora do kebaba — pusta lista, gdy nie znamy uid
// (stare dokumenty) albo autorem jest moderator (wpis panelu). `label` doprecyzowuje
// KOGO blokujemy, gdy w wierszu jest więcej niż jeden autor (punkt vs opis).
function blockActions(
  uid: string,
  name: string,
  blocked: Set<string>,
  after?: () => void,
  label?: string,
): KebabAction[] {
  if (!uid) return [];
  const kogo = label ?? "Zablokuj autora";
  return blocked.has(uid)
    ? [{ label: label ? label.replace("Zablokuj", "Odblokuj") : "Odblokuj autora", onClick: () => actUnblock(uid, after) }]
    : [{ label: kogo, variant: "destructive", onClick: () => actBlock(uid, name, after) }];
}

function ContentRow({
  item,
  pointById,
  probedIds,
  userNames,
  blocked,
  onEdit,
  reload,
}: {
  item: ContentItem;
  pointById: Map<string, DescriptionItem>;
  probedIds: Set<string>;
  userNames: Map<string, string>;
  blocked: Set<string>;
  onEdit: (e: EditingPoint) => void;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Cel zgłoszenia — doładowywany w TLE tylko dla OTWARTYCH zgłoszeń (akcje na
  // celu). Zamknięte zgłoszenie jest zapisem historycznym, bez akcji.
  const isOpenReport = item.kind === "report" && item.r.status === "open";
  const [target, setTarget] = useState<CommentItem | DescriptionItem | null | undefined>(undefined);
  const reportPointId = item.kind === "report" ? item.r.pointId : "";
  const reportCommentId = item.kind === "report" ? item.r.commentId : null;
  useEffect(() => {
    if (!isOpenReport) return;
    let alive = true;
    const p = reportCommentId
      ? fetchCommentById(reportPointId, reportCommentId)
      : fetchDescriptionById(reportPointId);
    p.then((t) => alive && setTarget(t)).catch(() => alive && setTarget(null));
    return () => { alive = false; };
  }, [isOpenReport, reportPointId, reportCommentId]);

  let author: React.ReactNode;
  let content: React.ReactNode;
  let state: React.ReactNode;
  let kebab: KebabAction[] = [];
  let historyPointId = "";
  let historyCommentId: string | null = null;

  // Lustro apki (`shelter.dart`: `name ?? type.labelPl`) — brak nazwy pokazuje
  // etykietę TYPU, nie gołe id. Surowe id zostaje jako OSTATECZNY fallback,
  // gdy nawet typu nie znamy (np. cel usunięty).
  // Nazwa punktu → etykieta TYPU, gdy nazwy brak (lustro apki: shelter.dart
  // `name ?? type.labelPl`) → „Punkt usunięty", gdy odpytaliśmy bazę i punktu
  // nie ma. Gołe id nie trafia do kolumny — dla człowieka nic nie znaczy;
  // zostaje w tooltipie [PointTitle].
  const titleOf = (pointId: string): string => {
    const pd = pointById.get(pointId);
    if (pd) return pd.name || SHELTER_TYPE_LABEL[pd.type] || "Punkt bez nazwy";
    return probedIds.has(pointId) ? "Punkt usunięty" : "Ładowanie…";
  };
  // Nazwa konta: zapisana przy treści → dociągnięta z `users` → jak w apce.
  const nameOf = (authorName: string, uid: string) =>
    authorName || userNames.get(uid) || "Użytkownik";

  switch (item.kind) {
    case "point":
    case "description": {
      const p = item.p;
      const isPanelPoint = p.createdVia === "moderation-panel";
      // Autor DOKUMENTU (twórca punktu) i autor OPISU to dwie różne osoby, gdy
      // opis dopisano do cudzego punktu — #615 rozdzielił je w apce, panel musi
      // to lustrzyć. Pokazujemy oba tylko wtedy, gdy się różnią.
      const opisAutor = p.description ? descriptionContributor(p) : null;
      const opisInny = !!opisAutor && opisAutor.uid !== p.authorUid;
      // ⛔ W wierszu `description` pierwszoplanowy jest autor OPISU, bo to jego
      // treść moderujemy. Odwrotna kolejność podpisywała cudzy opis twórcą
      // punktu — przy punktach z panelu wychodziło „Zespół Hyc!" pogrubione nad
      // opisem, którego zespół nie napisał (zgłoszenie usera 0818). Wiersz
      // `point` zostaje bez zmian: tam bohaterem jest właśnie twórca punktu.
      const opisNaCzele = item.kind === "description" && opisInny;
      author = (
        <div className="flex flex-col gap-1">
          {opisNaCzele ? (
            <>
              <AuthorCell
                name={opisAutor.name}
                uid={opisAutor.uid ?? ""}
                blocked={!!opisAutor.uid && blocked.has(opisAutor.uid)}
              />
              <span className="text-xs text-muted-foreground" title={p.authorUid || undefined}>
                punkt: {nameOf(p.authorName, p.authorUid)}
              </span>
            </>
          ) : (
            <AuthorCell name={nameOf(p.authorName, p.authorUid)} uid={p.authorUid} blocked={blocked.has(p.authorUid)} />
          )}
          {opisInny && !opisNaCzele && (
            <span className="text-xs text-muted-foreground" title={opisAutor.uid ?? undefined}>
              opis: {opisAutor.name}
            </span>
          )}
          {/* Opis bez atrybucji: dokument legacy, w którym opis dopisano
              PÓŹNIEJ niż powstał punkt — tożsamości autora nie da się już
              odzyskać. Milczymy zamiast przypisać go twórcy punktu. */}
          {p.description && !opisAutor && (
            <span className="text-xs italic text-muted-foreground">opis: autor nieznany</span>
          )}
        </div>
      );
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={p.pointId}>{titleOf(p.pointId)}</span>
          <PointProps p={p} />
          {p.description ? (
            <p className="line-clamp-3 whitespace-pre-wrap break-words">{p.description}</p>
          ) : (
            <span className="text-xs italic text-muted-foreground">bez opisu</span>
          )}
        </div>
      );
      state = <StateBadge state={p.state} />;
      // Publikuj/Ukryj opis USUNIĘTE z tego widoku (decyzja usera 0812) —
      // korekta treści idzie przez „Edytuj punkt" zamiast osobnego stanu
      // widoczności. Kolejka (needs_review) zostaje z własnym Publikuj/Ukryj —
      // to inny przepływ (moderacja pre-publikacji), nietknięty.
      kebab = [
        { label: "Edytuj punkt", onClick: () => onEdit({ p }) },
        ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
        ...(isPanelPoint ? [] : blockActions(p.authorUid, p.authorName, blocked, undefined,
          opisInny ? "Zablokuj autora punktu" : undefined)),
        // ⛔ Osobna pozycja, gdy opis jest CUDZY: bez niej „Zablokuj autora"
        // przy wierszu z obraźliwym opisem trafiałoby w twórcę punktu, czyli
        // w niewinną osobę. Blokujemy tego, kto napisał treść.
        ...(opisInny && opisAutor.uid
          ? blockActions(opisAutor.uid, opisAutor.name, blocked, undefined, "Zablokuj autora opisu")
          : []),
        { label: "Usuń punkt", variant: "destructive", onClick: () => actDeletePoint(p.pointId, p.name, reload) },
      ];
      historyPointId = p.pointId;
      break;
    }
    case "comment": {
      const c = item.c;
      const parent = pointById.get(c.pointId);
      author = <AuthorCell name={nameOf(c.authorName, c.authorUid)} uid={c.authorUid} blocked={blocked.has(c.authorUid)} />;
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={c.pointId}>{titleOf(c.pointId)}</span>
          {c.text
            ? <p className="line-clamp-3 whitespace-pre-wrap break-words">{c.text}</p>
            : <span className="text-xs italic text-muted-foreground">[brak treści]</span>}
        </div>
      );
      state = (
        <div className="flex flex-col items-start gap-1">
          <StateBadge state={c.state} />
          {c.status !== "active" && <StatusBadge status={c.status} />}
        </div>
      );
      kebab = [
        ...(c.state !== "approved"
          ? [{ label: "Opublikuj komentarz", onClick: () => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Opublikowano", reload) }]
          : []),
        ...(c.status !== "removed"
          ? [{
              label: "Ukryj komentarz",
              onClick: () => confirmHide("komentarz") && act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Ukryto", reload),
            }]
          : []),
        ...(parent && mapLink(parent.lat, parent.lon) ? [{ label: "Pokaż na mapie", href: mapLink(parent.lat, parent.lon)! }] : []),
        ...blockActions(c.authorUid, c.authorName, blocked),
      ];
      historyPointId = c.pointId;
      historyCommentId = c.commentId;
      break;
    }
    case "report": {
      const r = item.r;
      const reason = r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—";
      // ⛔ W wierszu zgłoszenia kolumna „Autor" pokazuje ZGŁASZAJĄCEGO, a akcje
      // w kebabie działają na autorze ZGŁOSZONEJ TREŚCI — to dwie różne osoby.
      // Bez tego podpisu moderator czyta nazwisko z kolumny i klika „Zablokuj
      // autora" przekonany, że blokuje właśnie ją.
      // Blokada zgłaszającego świadomie NIEDOSTĘPNA (zgłaszanie to nie treść).
      author = r.reporterUid
        ? <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">zgłosił</span>
            <AuthorCell
              name={nameOf("", r.reporterUid)}
              uid={r.reporterUid}
              blocked={blocked.has(r.reporterUid)}
            />
          </div>
        : <span className="text-muted-foreground">—</span>;
      content = (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold break-words" title={r.pointId}>
            {titleOf(r.pointId)}
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              {TARGET_LABEL[r.target] ?? r.target} · {reason}
            </span>
          </span>
          {r.reason
            ? <p className="line-clamp-3 whitespace-pre-wrap break-words">{r.reason}</p>
            : <span className="text-xs italic text-muted-foreground">bez uzasadnienia</span>}
        </div>
      );
      state = <ReportStatusBadge r={r} />;
      if (isOpenReport) {
        const closeActioned = () =>
          act({ action: "closeReport", reportId: r.id, resolution: "actioned" }, "Zgłoszenie zamknięte", reload);
        const c = target && r.target === "comment" ? (target as CommentItem) : null;
        const p = target && r.target !== "comment" ? (target as DescriptionItem) : null;
        const hidden = target?.state === "rejected";
        kebab = [
          ...(c
            ? [
                hidden
                  ? { label: "Opublikuj komentarz", onClick: () => act({ action: "approveComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz opublikowany", closeActioned) }
                  : {
                      label: "Ukryj komentarz",
                      onClick: () =>
                        confirmHide("komentarz") &&
                        act({ action: "rejectComment", pointId: r.pointId, commentId: r.commentId! }, "Komentarz ukryty", closeActioned),
                    },
                // Etykieta mówi KOGO, bo kolumna „Autor" pokazuje tu zgłaszającego.
                ...blockActions(c.authorUid, c.authorName, blocked, undefined, "Zablokuj autora komentarza"),
              ]
            : []),
          ...(p
            ? [
                // Opublikuj/Ukryj opis usunięte tu też — edycja punktu zamyka
                // zgłoszenie przez onSaved, więc alternatywna droga zostaje.
                { label: "Edytuj punkt", onClick: () => onEdit({ p, onSaved: closeActioned }) },
                ...(mapLink(p.lat, p.lon) ? [{ label: "Pokaż na mapie", href: mapLink(p.lat, p.lon)! }] : []),
                // Parytet z wierszem opisu: autora da się zablokować także z
                // poziomu zgłoszenia (chyba że to wpis panelu). ⛔ Zgłoszenie
                // o celu `description` dotyczy OPISU, więc blokada musi trafić
                // w jego autora — przy cudzym opisie twórca punktu jest tu
                // osobą postronną.
                ...(p.createdVia === "moderation-panel"
                  ? []
                  : (() => {
                      const a = r.target === "description" && p.description
                        ? descriptionContributor(p)
                        : null;
                      const inny = !!a && a.uid !== p.authorUid;
                      return inny && a.uid
                        ? blockActions(a.uid, a.name, blocked, undefined, "Zablokuj autora opisu")
                        : blockActions(p.authorUid, p.authorName, blocked, undefined, "Zablokuj autora punktu");
                    })()),
                { label: "Usuń punkt", variant: "destructive" as const, onClick: () => actDeletePoint(r.pointId, p.name ?? "", closeActioned) },
              ]
            : []),
          {
            label: "Odrzuć zgłoszenie",
            // Zamknięcia (dismissed) nie da się cofnąć z panelu (brak akcji
            // „otwórz ponownie") — potwierdzenie na modalu.
            onClick: () => {
              if (window.confirm("Odrzucić zgłoszenie jako niezasadne? Treść zostaje bez zmian, zgłoszenia nie da się potem ponownie otworzyć z panelu.")) {
                act({ action: "closeReport", reportId: r.id, resolution: "dismissed" }, "Zgłoszenie odrzucone (niezasadne)", reload);
              }
            },
          },
        ];
      } else {
        const parent = pointById.get(r.pointId);
        kebab = parent && mapLink(parent.lat, parent.lon) ? [{ label: "Pokaż na mapie", href: mapLink(parent.lat, parent.lon)! }] : [];
      }
      historyPointId = r.pointId;
      historyCommentId = r.commentId;
      break;
    }
  }

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            title={item.kind === "report" ? "Zgłoszona treść i historia decyzji" : "Historia decyzji"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col items-start gap-1">
            <KindBadge kind={item.kind} />
            {item.isTest && <TestBadge />}
          </div>
        </TableCell>
        <TableCell className="align-top text-sm">{author}</TableCell>
        <TableCell className="align-top text-sm">{content}</TableCell>
        <TableCell className="align-top">{state}</TableCell>
        <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(item.createdAt)}</TableCell>
        <TableCell className="align-top text-right">
          <KebabMenu actions={kebab} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30">
            <div className="space-y-3 py-1">
              {item.kind === "report" && (
                target === undefined && isOpenReport ? (
                  <span className="text-xs text-muted-foreground">Ładowanie zgłoszonej treści…</span>
                ) : target ? (
                  <ReportPreview target={target} isComment={item.r.target === "comment"} />
                ) : (
                  <span className="text-xs text-muted-foreground">Zgłoszona treść niedostępna (usunięta albo zgłoszenie zamknięte).</span>
                )
              )}
              <HistoryPanel pointId={historyPointId} commentId={historyCommentId} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
