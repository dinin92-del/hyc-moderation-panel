// Potwierdzenie z opcjonalnym powodem, wołane z funkcji akcji spoza Reacta.
// Host rejestruje się w drzewie komponentów (components/confirm-host.tsx).
export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Pole powodu. `minLength` > 0 blokuje potwierdzenie krótszego wpisu. */
  reason?: { label: string; placeholder?: string; minLength?: number };
};

export type ConfirmRequest = ConfirmOptions & {
  resolve: (result: { reason: string } | null) => void;
};

let show: ((request: ConfirmRequest) => void) | null = null;
let pending: ConfirmRequest["resolve"] | null = null;

export function registerConfirmHost(fn: ((request: ConfirmRequest) => void) | null) {
  show = fn;
}

/** Null = moderator się wycofał. */
export function confirmDialog(options: ConfirmOptions): Promise<{ reason: string } | null> {
  return new Promise((resolve) => {
    if (!show) throw new Error("Brak ConfirmHost w drzewie komponentów");
    // Nowy dialog zastępuje stary, a jego wywołujący nie może czekać w nieskończoność.
    pending?.(null);
    pending = resolve;
    show({ ...options, resolve });
  });
}
