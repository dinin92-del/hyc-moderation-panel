import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import {
  decide,
  deletePoint,
  restorePoint,
  setUserBlock,
  unblockUser,
} from "@/lib/moderation";

// Lock PER-CEL (nie globalny): różne wiersze działają równolegle, ta sama akcja
// na tym samym celu jest deduplikowana (double-click / szybki retry).
export const inFlight = new Set<string>();

function actKey(input: Parameters<typeof decide>[0]): string {
  if (input.action === "closeReport") return `report:${input.reportId}`;
  return `${input.action}:${input.pointId ?? ""}/${input.commentId ?? ""}`;
}

async function run(key: string, okMsg: string, work: () => Promise<void>, after?: () => void) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await work();
    toast.success(okMsg);
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  } finally {
    inFlight.delete(key);
  }
}

export function act(input: Parameters<typeof decide>[0], okMsg: string, after?: () => void) {
  return run(actKey(input), okMsg, () => decide(input), after);
}

const REASON_FIELD = { label: "Powód (opcjonalny, zostaje w historii)" };

/** Ukrycie komentarza albo opisu, z powodem do historii decyzji. */
export async function actHide(
  input: Parameters<typeof decide>[0],
  what: string,
  okMsg: string,
  after?: () => void,
) {
  const ok = await confirmDialog({
    title: `Ukryć ${what}?`,
    body: "Zniknie z aplikacji. Można go opublikować ponownie.",
    confirmLabel: "Ukryj",
    destructive: true,
    reason: REASON_FIELD,
  });
  if (ok) await act({ ...input, reason: ok.reason }, okMsg, after);
}

// Blokada autora — osobny callable (setUserBlock), z twardym potwierdzeniem.
// Wymaga authorUid; przy braku (starsze dokumenty) informuje zamiast cicho paść.
export async function actBlock(targetUid: string, authorName: string, after?: () => void) {
  if (!targetUid) {
    toast.error("Brak identyfikatora autora, nie można zablokować.");
    return;
  }
  const ok = await confirmDialog({
    title: `Zablokować autora „${authorName || "Użytkownik"}"?`,
    body: "Nie będzie mógł dodawać opisów, komentarzy ani zgłoszeń, dopóki go nie odblokujesz.",
    confirmLabel: "Zablokuj",
    destructive: true,
    reason: REASON_FIELD,
  });
  if (!ok) return;
  await run(`block:${targetUid}`, "Autor zablokowany",
    () => setUserBlock(targetUid, true, ok.reason), after);
}

// Punkt UGC żyje tylko w Firestore, więc znika na stałe. Punkt z bazy jest w assecie
// apki i dostaje tombstone, który da się zdjąć.
export async function actDeletePoint(pointId: string, pointName: string, after?: () => void) {
  const isUgc = pointId.startsWith("UGC:");
  const ok = await confirmDialog({
    title: `Usunąć punkt „${pointName || pointId}"?`,
    body: isUgc
      ? "Punkt zniknie na stałe razem z komentarzami i zdjęciami. Tego nie da się cofnąć."
      : "Punkt zniknie z mapy wszystkim użytkownikom, a jego komentarze i opis zostaną skasowane. " +
        "Sam punkt da się przywrócić w zakładce Punkty, widok Usunięte.",
    confirmLabel: "Usuń punkt",
    destructive: true,
    reason: REASON_FIELD,
  });
  if (!ok) return;
  await run(`deletePoint:${pointId}`, "Punkt usunięty",
    () => deletePoint(pointId, ok.reason), after);
}

export async function actRestorePoint(pointId: string, pointName: string, after?: () => void) {
  const ok = await confirmDialog({
    title: `Przywrócić punkt „${pointName || pointId}"?`,
    body: "Punkt wróci na mapę. Komentarze i opis skasowane przy usunięciu nie wrócą.",
    confirmLabel: "Przywróć",
    reason: { label: "Dlaczego wraca (zostaje w historii)", minLength: 25 },
  });
  if (!ok) return;
  await run(`restorePoint:${pointId}`, "Punkt przywrócony",
    () => restorePoint(pointId, ok.reason), after);
}

// Odblokowanie autora z listy „Zablokowani".
export async function actUnblock(targetUid: string, after?: () => void) {
  const ok = await confirmDialog({
    title: "Odblokować tego autora?",
    body: "Znów będzie mógł dodawać treści.",
    confirmLabel: "Odblokuj",
    reason: REASON_FIELD,
  });
  if (!ok) return;
  await run(`unblock:${targetUid}`, "Autor odblokowany",
    () => unblockUser(targetUid, ok.reason), after);
}

type ReportTarget = { pointId: string; commentId?: string | null };

/** Zamyka zgłoszenia wszystkich osób o ten cel. Dla komentarza tylko o ten komentarz. */
export function closeTargetReports(
  target: ReportTarget,
  resolution: "actioned" | "dismissed",
  extra: { reason?: string; includeComments?: boolean } = {},
  after?: () => void,
) {
  const okMsg = resolution === "actioned" ? "Zgłoszenia zamknięte" : "Zgłoszenia odrzucone";
  return act({
    action: "closeReportsForTarget",
    pointId: target.pointId,
    commentId: target.commentId ?? undefined,
    resolution,
    ...extra,
  }, okMsg, after);
}

/** Odrzucenie zgłoszeń: treść zostaje, a zgłaszający dostaje mail o decyzji. */
export async function actDismissReports(target: ReportTarget, after?: () => void) {
  const ok = await confirmDialog({
    title: "Odrzucić zgłoszenia?",
    body: "Treść zostaje bez zmian, a zgłaszający dostanie maila z tą decyzją. " +
      "Zamkniętego zgłoszenia nie da się otworzyć ponownie.",
    confirmLabel: "Odrzuć zgłoszenia",
    reason: REASON_FIELD,
  });
  if (ok) await closeTargetReports(target, "dismissed", { reason: ok.reason }, after);
}
