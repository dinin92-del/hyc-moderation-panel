/**
 * Format numeru telefonu punktu DO WYŚWIETLENIA — druga kopia reguły z apki.
 *
 * ⛔ ŹRÓDŁO PRAWDY: `lib/core/models/phone_number.dart` w repo `hyc_do_budy`
 * (funkcja `formatPhoneDisplay`). Panel pokazuje moderatorowi PODGLĄD tego, co
 * user zobaczy w apce, więc rozjazd kopii jest gorszy niż brak podglądu:
 * moderator zobaczyłby kształt, którego apka nigdy nie wyrenderuje. Zmieniasz
 * regułę po jednej stronie → zmieniasz po obu w tym samym kroku.
 *
 * ⚠ Panel NIE przepisuje numeru w bazie. Input zostaje surowy (moderator widzi
 * dokładnie to, co jest zapisane), formatowanie żyje wyłącznie na ekranie —
 * inaczej każda edycja punktu cicho nadpisywałaby zapis ze źródła.
 */

/** Numer sprowadzony do cyfr (z zachowanym wiodącym `+`). */
function dialDigits(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return phone.trimStart().startsWith("+") ? `+${digits}` : digits;
}

/**
 * Dwucyfrowe polskie kierunkowe stacjonarne (geograficzne). Numer 9-cyfrowy
 * zaczynający się od jednego z nich to telefon domowy i grupuje się `AA XXX XX XX`.
 * Zbiory kierunkowych i prefiksów komórkowych są rozłączne, więc 9 cyfr SPOZA tej
 * listy traktujemy jako komórkę (3-3-3) — bezpieczny fallback.
 */
const PL_LANDLINE_AREA_CODES = new Set([
  "12", "13", "14", "15", "16", "17", "18", "22", "23", "24", "25", "29",
  "32", "33", "34", "41", "42", "43", "44", "46", "47", "48", "52", "54",
  "55", "56", "58", "59", "61", "62", "63", "65", "67", "68", "71", "74",
  "75", "76", "77", "81", "82", "83", "84", "85", "86", "87", "89", "91",
  "94", "95",
]);

/** `XXX XXX XXX` — komórka (PL, CZ, SK). */
const group333 = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;

/** `AA XXX XX XX` — stacjonarny z dwucyfrowym kierunkowym (PL i SK). */
const groupAreaTwo = (n: string) =>
  `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;

/**
 * Polski numer krajowy: stacjonarny `AA XXX XX XX` (BEZ `+48` — dla numeru
 * domowego kierunkowy kraju jest obcym zapisem), komórka `+48 XXX XXX XXX`.
 */
const formatPolishLocal = (local: string) =>
  PL_LANDLINE_AREA_CODES.has(local.slice(0, 2))
    ? groupAreaTwo(local)
    : `+48 ${group333(local)}`;

/** Słowacki numer krajowy: komórka `9…`, Bratysława (kierunkowy `2` + 8 cyfr), reszta 2+7. */
function formatSlovakLocal(n: string): string {
  if (n.startsWith("9")) return group333(n);
  if (n.startsWith("2")) return `2 ${n.slice(1, 5)} ${n.slice(5)}`;
  return groupAreaTwo(n);
}

/**
 * Numer tak, jak zobaczy go user w karcie punktu. Polski (9 cyfr, z `+48`/`48`
 * lub bez, także ze starym zerem międzymiastowym) i czeski/słowacki dostają
 * format swojego kraju; każdy inny — w tym niemiecki, którego kierunkowy ma od
 * 2 do 5 cyfr i nie da się go wyprowadzić z samego numeru — zostaje surowy.
 */
export function formatPhoneDisplay(phone: string): string {
  const dial = dialDigits(phone);
  const digits = dial.startsWith("+") ? dial.slice(1) : dial;
  const plus = dial.startsWith("+");

  let local: string | null = null;
  if (digits.length === 9 && !plus) local = digits;
  // Stare ZERO MIĘDZYMIASTOWE (`(094) 35 15 656`) — zero nie jest częścią numeru.
  else if (digits.length === 10 && !plus && digits.startsWith("0")) local = digits.slice(1);
  else if (digits.length === 11 && digits.startsWith("48")) local = digits.slice(2);
  if (local !== null) return formatPolishLocal(local);

  // CZ/SK: kierunkowy kraju + dokładnie 9 cyfr krajowych. Inna długość znaczy, że
  // numer nie jest tym, na co wygląda — wtedy zostaje surowy.
  if (digits.length === 12) {
    const country = digits.slice(0, 3);
    const national = digits.slice(3);
    if (country === "420") return `+420 ${group333(national)}`;
    if (country === "421") return `+421 ${formatSlovakLocal(national)}`;
  }

  return phone.trim();
}
