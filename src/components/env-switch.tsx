"use client";

import { ACTIVE_ENV, setPanelEnv, type PanelEnv } from "@/lib/firebase";

// Przełącznik kontekstu DEV/PROD — neutralny segmented control (szary track,
// biała aktywna pastylka). DEV = dane testowe (hyc-do-budy-dev), PROD = prawdziwe
// komentarze. Zmiana kontekstu przeładowuje panel (setPanelEnv).
const OPTIONS: { env: PanelEnv; label: string; hint: string }[] = [
  { env: "dev", label: "DEV", hint: "Dane testowe (projekt hyc-do-budy-dev)" },
  { env: "prod", label: "PROD", hint: "Prawdziwe komentarze (hyc-do-udy)" },
];

export function EnvSwitch() {
  return (
    <div
      className="inline-flex items-center rounded-md border bg-neutral-100 p-0.5"
      role="group"
      aria-label="Kontekst danych"
    >
      {OPTIONS.map(({ env, label, hint }) => {
        const active = ACTIVE_ENV === env;
        return (
          <button
            key={env}
            type="button"
            title={hint}
            onClick={() => {
              if (!active) setPanelEnv(env);
            }}
            className={
              "px-3 py-1 text-xs font-semibold rounded transition-colors " +
              (active
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500 hover:text-neutral-800")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Pasek kontekstu pod nagłówkiem — neutralny (szary). Rozróżnienie DEV/PROD niesie
// treść, nie krzykliwy kolor.
export function EnvBanner() {
  if (ACTIVE_ENV === "dev") {
    return (
      <div className="border-b bg-neutral-50 px-6 py-1.5 text-center text-xs text-neutral-500">
        Kontekst <strong className="text-neutral-700">DEV</strong> — projekt testowy hyc-do-budy-dev. Zmiany nie dotykają produkcji.
      </div>
    );
  }
  return (
    <div className="border-b bg-neutral-50 px-6 py-1.5 text-center text-xs text-neutral-500">
      Kontekst <strong className="text-neutral-700">PROD</strong> — prawdziwe komentarze użytkowników. Decyzje wpływają na aplikację.
    </div>
  );
}
