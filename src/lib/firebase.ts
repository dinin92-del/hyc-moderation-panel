import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FB_API_KEY!,
  appId: process.env.NEXT_PUBLIC_FB_APP_ID!,
  messagingSenderId: process.env.NEXT_PUBLIC_FB_SENDER_ID!,
  projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID!,
  authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN!,
  storageBucket: process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET!,
};

const app = getApps().length ? getApp() : initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
// Region jak Cloud Functions (setGlobalOptions europe-central2) — inaczej callable
// trafia w domyślny us-central1 i zwraca NOT_FOUND.
export const functions = getFunctions(
  app,
  process.env.NEXT_PUBLIC_FB_REGION || "europe-central2",
);
