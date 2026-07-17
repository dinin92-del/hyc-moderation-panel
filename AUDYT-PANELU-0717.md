# Audyt panelu moderatora (web) — 2026-07-17

Zakres: `/Volumes/X10/dev/moderation-panel` (Next.js static export → Firebase Hosting).
Cel: ocena UX + funkcjonalna, dobre praktyki, automatyzacja, nowe akcje (usuwanie/
przenoszenie punktów), domknięcie tematu platformy. **Panel tylko desktop/web** —
mobilny in-app panel odrzucony na stałe.

---

## A. Stan obecny (co JEST)

**Stack:** Next 16 `output: export` (czysty client-SPA → `out/` na Firebase Hosting,
CDN darmowo), React 19, Firebase 12 web SDK, TypeScript, Tailwind + shadcn/ui, sonner
(toasty). Region `europe-central2`.

**Auth i role:** `AuthGate` — logowanie Google (popup) + e-mail/hasło. Rola `moderator`
czytana klientem z `users/{uid}.role`; twarda bramka po stronie serwera = reguły
Firestore `isMod()` + callable `isMod`. Obrona w głębi (SPA publiczny, ale dane i akcje
chroni serwer).

**Env switch DEV/PROD:** `hyc-do-budy-dev` vs `hyc-do-udy`, w `localStorage`, zmiana
przeładowuje panel; `EnvBanner` ostrzega o kontekście.

**3 zakładki:**
- **Kolejka** — komentarze `needs_review` (collectionGroup), opisy `needs_review`
  (points), otwarte `reports`. Live (`onSnapshot`). Checkbox „Ukryj testowe".
- **Historia decyzji** — `moderationLog` live, filtr all/komentarz/opis, kolumny
  AI / Człowiek / Override.
- **Wszystkie treści** — `fetchAll` komentarze/opisy (każdy stan), filtr.

**Akcje (kebab):**
- komentarz: Zatwierdź / Odrzuć / Zablokuj autora
- opis: Zatwierdź / Odrzuć / Zablokuj autora / Pokaż na mapie (mapy.cz)
- zgłoszenie: Zasadne — zamknij / Odrzuć zgłoszenie

**Backend:** callable `onModeratorDecision` (approve/reject komentarz+opis, closeReport)
+ `setUserBlock` (ban). `moderationLog` zapisuje werdykt AI vs człowiek + flagę override.

---

## B. Audyt UX (problemy → fix)

1. **Ciche ucięcie list.** `QUEUE_LIMIT=200`, `BROWSE_LIMIT=400` — brak informacji
   „pokazano 200 z N". Przy backlogu moderator myśli, że to całość. → pokaż licznik/
   ostrzeżenie, gdy wynik == limit; paginacja lub „załaduj więcej".
2. **`actInFlight` = globalny bool** (page.tsx:46) — jedna akcja blokuje WSZYSTKIE
   wiersze, nawet niezwiązane. → stan „pending" per-wiersz; różne wiersze równolegle.
3. **Kebab na każdą decyzję = 2 kliki.** Przy wolumenie za dużo. → 1-klik inline
   Zatwierdź/Odrzuć w wierszu + kebab tylko na rzadkie; skróty klawiszowe (A/R, J/K
   nawigacja, potwierdzenie Enter).
4. **Zgłoszenie nie pokazuje treści celu.** Wiersz reportu = tylko `pointId`/`commentId`
   + powód; moderator nie widzi CO zgłoszono bez ręcznego szukania w innej zakładce.
   → rozwiń cel inline (treść komentarza/opisu) + akcje na cel wprost z reportu
   (zatwierdź/odrzuć/usuń). Największy pojedynczy zysk UX.
5. **Brak wyszukiwarki** (autor, pointId, fragment treści) w kolejce i „Wszystkich
   treściach".
6. **Brak akcji zbiorczych** (zaznacz N → zatwierdź/odrzuć).
7. **Brak cofania.** Akcja natychmiast, tylko toast. → toast z „Cofnij" (5 s) albo
   soft-window przed utrwaleniem.
8. **Brak powodu przy odrzuceniu.** `moderationLog` ma pole `reason`, UI go nie zbiera;
   `setUserBlock` ma param `reason` — nieprzekazywany. → opcjonalny powód (zasila log
   i uczenie AI, uzasadnia ban).
9. **`window.confirm`** natywne, blokujące, poza DS. Drobne — do podmiany na dialog.
10. **„Ukryj testowe"** per-zakładka, nie zapamiętywane. → `localStorage`.
11. **Historia**: `reviewerUid` niezmapowany na nazwę; brak filtra po moderatorze/
    dacie/„tylko override".
12. **Brak wieku/SLA** — nie widać, jak długo najstarszy item czeka.

---

## C. Braki funkcjonalne + NOWE akcje (usuwanie / przenoszenie punktów)

> Reguły Firestore JUŻ dają moderatorowi twarde prawa: `points allow delete: if isMod()`,
> `comments allow delete: if isMod()`, `reports delete: isMod`. Panel tych możliwości
> NIE wystawia — backend/rules gotowe, brakuje UI + (dla kaskad) callable.

- **USUŃ PUNKT (cały).** Dziś „Odrzuć opis" tylko ukrywa opis — punkt zostaje. Spam/
  duplikat/fake = brak twardego kasowania. → akcja „Usuń punkt" przez **callable
  serwerowy z kaskadą** (punkt + komentarze + `saved/*`), nie delete z klienta
  (spójność, jak przy usuwaniu konta). Dotyczy głównie UGC.
- **EDYCJA/POPRAWA punktu.** Zła nazwa, zły typ, złe współrzędne, złe flagi (woda/
  ognisko/nocleg/awaryjne). Moderator nie może korygować — tylko approve/reject. →
  edycja pól (kuratorska wartość); dziś to strata.
- **PRZENIEŚ punkt** (fix `lat`/`lon`) — podzbiór edycji; wpis współrzędnych lub pin
  na mapie.
- **EDYCJA treści** (opis/komentarz) zamiast twardego reject — popraw literówkę /
  strip PII, zachowaj wartość.
- **MERGE duplikatów** (dwa punkty = ten sam obiekt).
- **UNBLOCK + lista zablokowanych.** Dziś tylko ban; `setUserBlock(blocked:false)`
  istnieje, UI go nie wystawia, brak widoku banów. → zakładka „Zablokowani" + odblokuj.
- **Reputacja/recydywa autora** — ile odrzuceń/zgłoszeń; widok „problematyczni autorzy".
- **Nawigacja report ↔ item** (z reportu do treści i z powrotem).

---

## D. Automatyzacja (perspektywy)

- **Auto-zamknięcie zgłoszenia**, gdy cel już `removed`/`approved` (dziś ręczny dismiss).
- **Auto-eskalacja:** `reportCount >= N` → priorytet/needs_review automatycznie.
- **Priorytet kolejki:** sort po `reportCount` desc + wiek, nie tylko „najnowsze".
- **Powód AI w wierszu kolejki.** `moderationLog.ai.{state,labels,score,reason}` istnieje,
  ale kolejka nie pokazuje, CZEMU item jest `needs_review`. → pokaż etykiety/score AI
  w wierszu = szybsza decyzja człowieka.
- **Powiadomienia progowe:** queue > N lub item czeka > X h → e-mail/Slack (dziś trzeba
  ręcznie wchodzić i patrzeć).
- **Reguły wsadowe:** znane wzorce spamu (URL, telefon) → auto-reject + do przeglądu.
- **Auto-approve zaufanych** — backend ma hybrydę zaufania; dodać w panelu podgląd
  „ile auto-zatwierdzono" (kontrola, że nie przepuszcza za dużo).
- **Metryki/dashboard + SLA:** decyzje dziś/tydzień, wskaźnik override AI, średni czas
  reakcji, trend backlogu.

---

## E. Bezpieczeństwo / dobre praktyki

- **Model dobry:** odczyty bramkowane regułami `isMod`, akcje przez callable `isMod`
  (serwer). Klient tylko wygodą.
- **App Check BRAK** (`firebase.ts` bez inicjalizacji). Callable/Firestore bez App
  Check — Auth chroni, ale App Check utnie boty/abuse tokenów. → rozważyć (web
  reCAPTCHA v3).
- **Brak error boundary** — wyjątek renderu = biały ekran. → dodać.
- **PROD/DEV w jednym panelu** — potężne; `EnvBanner` + reload = dobra izolacja. Ryzyko:
  akcja na PROD w przekonaniu, że DEV. → wyraźniejsze rozróżnienie PROD (kolor/twarde
  potwierdzenie przy 1. akcji PROD w sesji).
- **`reason` bana nieprzekazywany** → ban bez uzasadnienia w logu.
- **Ciche ucięcie** (B1) to też problem obserwowalności.

---

## F. Roadmap „domknięcie platformy" (priorytety)

**P0 — duża wartość, tanie:**
- Podgląd celu + akcje z poziomu zgłoszenia (B4).
- Powód AI w wierszu kolejki (D).
- Fix cichego ucięcia + „pending" per-wiersz (B1, B2).
- Unblock + lista zablokowanych (C).

**P1:**
- **Usuń punkt** (kaskada serwerowa) + **edytuj punkt** (nazwa/typ/coords/flagi) (C) —
  wprost prośba usera.
- 1-klik inline approve/reject + skróty + akcje zbiorcze (B3, B6).
- Powód przy odrzuceniu (B8).

**P2:**
- Automatyzacja: auto-close zgłoszeń, eskalacja `reportCount`, powiadomienia progowe (D).
- Metryki/dashboard + SLA (D).
- App Check + error boundary (E).

**P3:**
- Reputacja autorów, merge duplikatów, edycja treści z PII-strip.

---

## Podsumowanie

Panel solidny w rdzeniu: dobry model bezpieczeństwa, live kolejki, historia z audytem
AI/człowiek, ban działający. Główne luki: (1) zgłoszenia bez podglądu celu, (2) brak
twardego usuwania/edycji punktów mimo że reguły to dopuszczają, (3) brak automatyzacji
i metryk, (4) drobne UX (ciche ucięcie, globalny lock, 2-klik kebab). P0+P1 domyka
platformę do stanu „operacyjnie kompletny".
