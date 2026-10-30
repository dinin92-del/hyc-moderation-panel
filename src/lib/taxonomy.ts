// AKTUALNA taksonomia (lustro `ShelterType` w lib/core/models/shelter.dart —
// kolejność = priorytet enuma). To jedyne kody, które wolno WYBRAĆ przy dodawaniu
// i edycji; backend odrzuca resztę (whitelist w applyModeratorCreatePoint).
//
// ⛔ ETYKIETY MUSZĄ SIĘ ZGADZAĆ Z APKĄ. Ta lista jest CZWARTĄ kopią etykiet kategorii
// (obok ShelterType.labelPl, name_canonical.BASE_LABEL i run_dedup.PLURAL_BASE w repo
// hyc_do_budy). Rozjazd nie wywala niczego głośno — moderator po prostu widzi inną nazwę
// kategorii niż user, i nikt się o tym nie dowiaduje.
// To repo jest PRYWATNE i osobne, więc CI apki tej kopii NIE WIDZI (świadomie nie dajemy
// jej PAT-a: wygasły token zamieniłby bramkę w cichy SKIP). Zamiast tego apka trzyma
// śledzony zrzut `scripts/taksonomia_etykiety.json`, którego świeżości pilnuje
// `scripts/check_etykiety_parytet.py` — każda zmiana etykiety jest tam GŁOŚNYM wierszem
// w diffie, z przypomnieniem o tym pliku. Zmieniasz etykietę tutaj albo tam → zmieniasz
// w OBU miejscach w tej samej robocie.
export const TAXONOMY_OPTIONS: Array<[code: string, label: string]> = [
  ["schronisko", "Schronisko"],
  ["nocleg", "Nocleg"],
  ["sklep", "Sklep"],
  ["stanica", "Stanica"],
  ["baza_namiotowa", "Baza namiotowa"],
  ["restauracja", "Restauracja"],
  ["obserwacyjne", "Obserwacyjne"],
  ["schronienie_skalne", "Schronienie skalne"],
  // [2026-09-23 user] „Schron" zastępuje wycofane chatka/bacowka — otwarty,
  // bezobsługowy schron turystyczny (parytet ShelterType.schron w apce,
  // lib/core/models/shelter.dart; ikona = bacowka_outline.svg).
  ["schron", "Schron"],
  ["opuszczone", "Opuszczony obiekt"],
  // [2026-08-19 user] „Baza biwakowa" → „Miejsce biwakowe" (parytet z apką,
  // lib/core/models/shelter.dart). Kod taksonomii `miejsce_biwakowe` bez zmiany.
  ["miejsce_biwakowe", "Miejsce biwakowe"],
  // [2026-09-07] Grupa medyczna (parytet z ShelterType w lib/core/models/shelter.dart,
  // priority 13/14/15) — cztery nowe, niezależne typy poza główną hierarchią schronień.
  ["ratownictwo_gorskie", "Ratownictwo górskie"],
  ["apteka", "Apteka"],
  ["apteczka", "Apteczka na szlaku"],
  ["wiata", "Wiata"],
  ["schronienie", "Schronienie"],
  // Grupa medyczna, dokończenie (priority 18 — wolny slot po `pasnik`, patrz shelter.dart).
  ["defibrylator", "Defibrylator (AED)"],
  ["przystanek", "Wiata przystankowa"],
  ["nieznane", "Typ nieznany"],
];

// Etykiety do WYŚWIETLANIA — taksonomia aktualna + kody wycofane, które mogą
// jeszcze siedzieć w starych dokumentach (alias `dom_turysty`, kategorie usunięte
// 07/2026). Wycofanych NIE ma w [TAXONOMY_OPTIONS], więc nie da się ich wybrać.
export const SHELTER_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(TAXONOMY_OPTIONS),
  dom_turysty: "Nocleg",
  // [2026-09-23] chatka/bacowka wycofane (rozbite na schron/nocleg/wiata/…).
  // Etykieta = ta sama, którą apka trzyma w enumie dla starych nakładek Firestore,
  // więc moderator widzi na legacy-punkcie to samo co user. Niepickowalne.
  chatka: "Chatka",
  bacowka: "Bacówka",
  parking_zadaszony: "Zadaszony parking (wycofane)",
  wiata_rowerowa: "Wiata rowerowa (wycofane)",
  altana: "Altana (wycofane)",
  daszek: "Daszek (wycofane)",
  pasnik: "Paśnik (wycofane)",
};
