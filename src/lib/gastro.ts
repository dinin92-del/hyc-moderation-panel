// Gastronomy tag of a point (plan gastronomia-w-noclegach-1113, panel switch §F).
//
// The panel sees ONLY the Firestore document. The asset flag (`ga`) is not in the
// panel index, so a missing `gastro` key means "no opinion, the asset decides",
// not "no food".
//
// ⛔ MIRROR of `GASTRO_TYPES` in functions/gastro_z_opisu.js (app repo). The callable
// rejects a boolean `gastro` for any other type, so a drift here shows up as an
// error toast, not as a silent wrong write.
export const GASTRO_TYPES: ReadonlySet<string> = new Set(["schronisko", "nocleg"]);

/** Three states of the switch. `none` sends `null` (clears `gastro` and `gastroSource`). */
export type GastroChoice = "none" | "tak" | "nie";

export const GASTRO_CHOICE_LABEL: Record<GastroChoice, string> = {
  none: "Brak zdania (decyduje baza)",
  tak: "Gastronomia: tak",
  nie: "Gastronomia: nie",
};

export const GASTRO_CHOICES: GastroChoice[] = ["none", "tak", "nie"];

export function isGastroType(type: string): boolean {
  return GASTRO_TYPES.has(type);
}

export function gastroToChoice(v: boolean | null): GastroChoice {
  return v === true ? "tak" : v === false ? "nie" : "none";
}

export function choiceToGastro(c: GastroChoice): boolean | null {
  return c === "tak" ? true : c === "nie" ? false : null;
}

/** `tak`, `nie` or `brak zdania` for read only rows. */
export function gastroWord(v: boolean | null): string {
  return v === true ? "tak" : v === false ? "nie" : "brak zdania";
}
