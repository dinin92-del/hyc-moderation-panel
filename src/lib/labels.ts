// Etykiety PL — lustro lib/core/models/report.dart + point_doc.dart z apki.

export const STATE_LABEL: Record<string, string> = {
  approved: "Zatwierdzony",
  rejected: "Odrzucony",
  needs_review: "Do sprawdzenia",
  pending: "Oczekuje",
  reviewing: "W weryfikacji",
};

// Kolor semantyczny stanu: zielony=ok, amber=czeka, czerwony=źle.
export function stateTone(state?: string): "ok" | "warn" | "bad" | "muted" {
  switch (state) {
    case "approved":
      return "ok";
    case "rejected":
      return "bad";
    case "needs_review":
    case "pending":
    case "reviewing":
      return "warn";
    default:
      return "muted";
  }
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Widoczny",
  hidden: "Ukryty",
  removed: "Usunięty",
};

export const TARGET_LABEL: Record<string, string> = {
  point: "Miejsce",
  description: "Opis",
  comment: "Komentarz",
};

export const FLAG_LABEL: Record<string, string> = {
  nie_istnieje: "Nie istnieje",
  duplikat: "Duplikat",
  zla_lokalizacja: "Zła lokalizacja / pinezka",
  czasowo_zamkniete: "Czasowo / sezonowo zamknięte",
  teren_prywatny: "Teren prywatny / zakaz wstępu",
  niedostepne: "Niedostępne",
  niebezpieczne: "Niebezpieczne / zagrożenie",
  zrujnowane: "Zrujnowane",
  nie_sluzy_schronienie: "Nie służy jako schronienie",
  zla_kategoria: "Zła kategoria / typ",
  bledne_dane: "Błędne dane",
  spam_falszywy: "Spam / fałszywy / reklama",
  inne: "Inne",
};

export const CATEGORY_LABEL: Record<string, string> = {
  spam: "Spam / reklama",
  obelga: "Obelga / nękanie",
  nienawisc: "Mowa nienawiści",
  grozby: "Groźby / przemoc",
  seks: "Treści seksualne",
  niebezpieczne: "Niebezpieczna porada",
  dezinformacja: "Nieprawda o miejscu",
  dane_osobowe: "Dane osobowe",
  off_topic: "Nie na temat",
  inne: "Inne",
};

export function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
