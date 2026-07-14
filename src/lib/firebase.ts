import { initializeApp, getApps, getApp } from "firebase/app";
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

const app = getApps().length ? getApp() : initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
// Region jak Cloud Functions (setGlobalOptions europe-central2) — inaczej callable
// trafia w domyślny us-central1 i zwraca NOT_FOUND.
export const functions = getFunctions(app, region);
