import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// ── Kontekst panelu: PROD vs DEV — OBA to prawdziwe projekty Firebase w chmurze ──
// PROD  = hyc-do-udy      (prawdziwe komentarze użytkowników)
// DEV   = hyc-do-budy-dev (osobny projekt testowy — te same funkcje, inne dane)
//
// Zakres funkcji identyczny — przełącznik zmienia tylko projekt (źródło danych).
// Logowanie działa TAK SAMO w obu (Firebase Auth); różnica jest tylko taka, że
// każdy projekt ma własną pulę kont — to samo hasło zakładasz w obu osobno.
//
// Wybór trzymany w localStorage; zmiana przeładowuje stronę (setPanelEnv), żeby
// cała warstwa Firebase — instancja, listenery, sesja logowania — re-inicjalizowała
// się czysto pod jeden projekt (zero mieszania prawdziwych i testowych danych).
export type PanelEnv = "prod" | "dev";
const ENV_KEY = "hyc-panel-env";

function readEnv(): PanelEnv {
  // SSR/build: brak window → PROD (bezpieczny domyślny; realna decyzja pada na kliencie).
  if (typeof window === "undefined") return "prod";
  const stored = window.localStorage.getItem(ENV_KEY);
  if (stored === "dev" || stored === "prod") return stored;
  return "prod";
}

export const ACTIVE_ENV: PanelEnv = readEnv();

/** Przełącza kontekst i przeładowuje panel. */
export function setPanelEnv(env: PanelEnv): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENV_KEY, env);
  window.location.reload();
}

const prodConfig = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY!,
  appId: process.env.NEXT_PUBLIC_FB_APP_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FB_SENDER_ID!,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID!,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN!,
  storageBucket: process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET!,
};

const devConfig = {
  apiKey: process.env.NEXT_PUBLIC_FB_DEV_API_KEY!,
  appId: process.env.NEXT_PUBLIC_FB_DEV_APP_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FB_DEV_SENDER_ID!,
  projectId: process.env.NEXT_PUBLIC_FB_DEV_PROJECT_ID!,
  authDomain: process.env.NEXT_PUBLIC_FB_DEV_AUTH_DOMAIN!,
  storageBucket: process.env.NEXT_PUBLIC_FB_DEV_STORAGE_BUCKET!,
};

const config = ACTIVE_ENV === "dev" ? devConfig : prodConfig;
const region =
  (ACTIVE_ENV === "dev"
    ? process.env.NEXT_PUBLIC_FB_DEV_REGION
    : process.env.NEXT_PUBLIC_FB_REGION) || "europe-central2";

const isNewApp = getApps().length === 0;
const app = isNewApp ? initializeApp(config) : getApp();

// ── App Check (reCAPTCHA v3) ──────────────────────────────────────────────────
// Panel czyta Firestore BEZPOŚREDNIO (kolejka moderacji: collectionGroup comments,
// reports, points). Gdy w konsoli włączymy App Check ENFORCE dla Firestore, KAŻDE
// żądanie bez ważnego tokenu App Check jest odrzucane — niezależnie od logowania.
// Bez tego bloku panel przestałby ładować kolejkę po enforce (audyt bezpieczeństwa
// 0717). site key reCAPTCHA v3 jest PUBLICZNY (klucz sekretny trzyma Firebase),
// więc jest bezpieczny w bundlu klienta. Rejestracja web app + klucz: konsola
// Firebase → App Check → Apps → web → reCAPTCHA v3. Init tylko przy PIERWSZym
// utworzeniu app (isNewApp) → brak 'appCheck/already-initialized' przy HMR.
if (isNewApp && typeof window !== "undefined") {
  const siteKey =
    ACTIVE_ENV === "dev"
      ? process.env.NEXT_PUBLIC_FB_DEV_APPCHECK_SITE_KEY
      : process.env.NEXT_PUBLIC_FB_APPCHECK_SITE_KEY;
  if (siteKey) {
    // Localhost/dev bez zarejestrowanej domeny → reCAPTCHA odrzuca. Debug token
    // pozwala pracować lokalnie: wypisany w konsoli przeglądarki token dodaj w
    // Firebase → App Check → Apps → web → Manage debug tokens.
    if (process.env.NODE_ENV !== "production") {
      (
        self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }
      ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (process.env.NODE_ENV === "production") {
    // Fail loud: brak klucza w produkcji = brak tokenów = panel padnie po enforce.
    console.error(
      "App Check: brak NEXT_PUBLIC_FB(_DEV)_APPCHECK_SITE_KEY — po włączeniu " +
        "enforce dla Firestore panel przestanie czytać dane moderacji.",
    );
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
// Region jak Cloud Functions (setGlobalOptions europe-central2) — inaczej callable
// trafia w domyślny us-central1 i zwraca NOT_FOUND.
export const functions = getFunctions(app, region);
