import { Badge } from "@/components/ui/badge";
import { STATE_LABEL, STATUS_LABEL, stateTone } from "@/lib/labels";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  ok: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  bad: "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  muted: "border-transparent bg-muted text-muted-foreground",
};

export function StateBadge({ state }: { state?: string }) {
  return (
    <Badge className={cn("font-medium", TONE[stateTone(state)])}>
      {STATE_LABEL[state ?? ""] ?? state ?? "—"}
    </Badge>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const tone = status === "active" ? "ok" : status === "removed" ? "bad" : "warn";
  return (
    <Badge variant="outline" className={cn("font-normal", TONE[tone])}>
      {STATUS_LABEL[status ?? ""] ?? status ?? "—"}
    </Badge>
  );
}
