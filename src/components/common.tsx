"use client";

import { MoreHorizontal, ExternalLink, Check, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QUEUE_LIMIT, type DescriptionItem, type PointOrigin } from "@/lib/moderation";
import { aiLabel } from "@/lib/labels";
import { SHELTER_TYPE_LABEL } from "@/lib/taxonomy";
import { actBlock, actUnblock } from "@/lib/actions";

const ORIGIN_TONE: Record<PointOrigin, string> = {
  asset: "border-border bg-muted text-muted-foreground",
  overlay: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  ugc: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
};

// Pochodzenie decyduje o tym, co moderator może zrobić: punkt z bazy nie zmieni
// pozycji, a usunięcie punktu spoza bazy jest ostateczne.
export function OriginBadge({ origin, createdVia }: { origin: PointOrigin; createdVia?: string | null }) {
  const label = origin === "asset"
    ? "Z bazy"
    : origin === "overlay"
      ? "Poprawiony"
      : createdVia === "moderation-panel" ? "Dodany w panelu" : "Od użytkownika";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${ORIGIN_TONE[origin]}`}>
      {label}
    </span>
  );
}

export function SuppressedBadge() {
  return (
    <span className="inline-flex items-center rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      Usunięty z mapy
    </span>
  );
}

export function PointProps({ p }: { p: Pick<DescriptionItem, "type"> }) {
  const typeLabel = SHELTER_TYPE_LABEL[p.type] ?? p.type ?? "";
  if (!typeLabel) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {typeLabel}
      </span>
    </div>
  );
}

export function TestBadge() {
  return (
    <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
      TEST
    </span>
  );
}

// Etykiety werdyktu filtra (moderation.labels[]) — czemu item trafił do kolejki.
export function LabelChips({ labels }: { labels: string[] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {labels.map((l) => (
        <span
          key={l}
          className="inline-flex items-center rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700"
        >
          {aiLabel(l)}
        </span>
      ))}
    </div>
  );
}

// Ostrzeżenie o ucięciu listy (osiągnięto twardy limit zapytania).
export function TruncNote({ shown }: { shown: number }) {
  if (shown < QUEUE_LIMIT) return null;
  return (
    <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-700">
      ⚠ Pokazano pierwsze {QUEUE_LIMIT} — lista może być dłuższa. Przejrzyj i odśwież, żeby zobaczyć resztę.
    </div>
  );
}

export function Section({ title, count, children, truncated }: { title: string; count: number; children: React.ReactNode; truncated?: number }) {
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

export function QueueError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="px-4 py-6 text-sm text-muted-foreground">{text}</div>;
}

export type KebabAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "destructive";
};

// Decyzja moderacyjna widoczna w wierszu (1 klik), nazwana SKUTKIEM —
// „Opublikuj"/„Ukryj" tłumaczą się same, bez legend i tooltipów z esejem.
// Ten sam komponent na każdej powierzchni (kolejki, zgłoszenia, przeglądarka);
// przycisk renderuje się tylko, gdy akcja ma sens w bieżącym stanie treści.
export function PublishHideButtons({ onPublish, onHide }: { onPublish?: () => void; onHide?: () => void }) {
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

export function KebabMenu({ actions, header }: { actions: KebabAction[]; header?: string }) {
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

export function FilterChips<T extends string>({
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

// Autor treści + status blokady. Blokada per WIERSZ (nie tylko lista
// „Zablokowani"), bo decyzję podejmuje się patrząc na treść.
// Nazwę podaje wywołujący (przez `nameOf`, z fallbackiem „Użytkownik" jak w
// aplikacji). uid trafia tu WYŁĄCZNIE do tooltipa — kolumna ma pokazywać
// człowieka, a nie identyfikator bazy; surowy uid był nieczytelny i mylił.
export function AuthorCell({ name, uid, blocked }: { name: string; uid: string; blocked: boolean }) {
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
export function blockActions(
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
