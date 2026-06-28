"use client";

import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GateState =
  | { phase: "loading" }
  | { phase: "anon" }
  | { phase: "denied"; email: string }
  | { phase: "ok"; user: User };

export function AuthGate({
  children,
}: {
  children: (ctx: { user: User; signOut: () => void }) => React.ReactNode;
}) {
  const [state, setState] = useState<GateState>({ phase: "loading" });
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return setState({ phase: "anon" });
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const role = snap.exists() ? (snap.data().role as string) : null;
        if (role === "moderator") setState({ phase: "ok", user: u });
        else setState({ phase: "denied", email: u.email ?? "" });
      } catch {
        setState({ phase: "denied", email: u.email ?? "" });
      }
    });
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch {
      setErr("Błędny e-mail lub hasło.");
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === "loading") {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Ładowanie…</div>;
  }

  if (state.phase === "ok") {
    return <>{children({ user: state.user, signOut: () => signOut(auth) })}</>;
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Panel moderatora — Hyc do Budy</CardTitle>
        </CardHeader>
        <CardContent>
          {state.phase === "denied" ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Konto <span className="font-medium">{state.email}</span> nie ma roli moderatora.
              </p>
              <Button variant="outline" onClick={() => signOut(auth)} className="w-full">
                Wyloguj
              </Button>
            </div>
          ) : (
            <form onSubmit={login} className="space-y-3">
              <Input
                type="email"
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <Input
                type="password"
                placeholder="Hasło"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
              />
              {err && <p className="text-sm text-red-600">{err}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Logowanie…" : "Zaloguj"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
