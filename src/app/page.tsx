"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { BlockedProvider } from "@/components/blocked-context";
import { BlockedTab } from "@/components/blocked-tab";
import { ContentTab } from "@/components/content-tab";
import { EnvSwitch, EnvBanner } from "@/components/env-switch";
import { AddPointDialog } from "@/components/point-forms";
import { QueueComments, QueueDescriptions, QueueReports } from "@/components/queue";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  watchCommentsQueue,
  watchDescriptionsQueue,
  watchReportsQueue,
  type CommentItem,
  type DescriptionItem,
  type ReportItem,
} from "@/lib/moderation";

export default function Home() {
  // Provider WEWNĄTRZ AuthGate — subskrypcja blokad startuje dopiero po
  // zalogowaniu moderatora (przed nim Firestore i tak odrzuci odczyt).
  return (
    <AuthGate>
      {({ user, signOut }) => (
        <BlockedProvider>
          <Panel email={user.email ?? ""} signOut={signOut} />
        </BlockedProvider>
      )}
    </AuthGate>
  );
}

function Panel({ email, signOut }: { email: string; signOut: () => void }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [descs, setDescs] = useState<DescriptionItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [commentsErr, setCommentsErr] = useState<string | null>(null);
  const [descsErr, setDescsErr] = useState<string | null>(null);
  const [reportsErr, setReportsErr] = useState<string | null>(null);
  const [hideTest, setHideTest] = useState(false);

  useEffect(() => {
    const u1 = watchCommentsQueue(
      (items) => { setCommentsErr(null); setComments(items); },
      () => setCommentsErr("Błąd kolejki komentarzy — indeks Firestore może być jeszcze w budowie. Odśwież za chwilę."),
    );
    const u2 = watchDescriptionsQueue(
      (items) => { setDescsErr(null); setDescs(items); },
      () => setDescsErr("Błąd kolejki opisów."),
    );
    const u3 = watchReportsQueue(
      (items) => { setReportsErr(null); setReports(items); },
      () => setReportsErr("Błąd kolejki zgłoszeń."),
    );
    return () => { u1(); u2(); u3(); };
  }, []);

  const queueTotal = comments.length + descs.length + reports.length;
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Panel moderatora</h1>
          <p className="text-xs text-muted-foreground">Hyc do Budy · {email}</p>
        </div>
        <div className="flex items-center gap-3">
          <EnvSwitch />
          <Button variant="outline" size="sm" onClick={signOut}>
            Wyloguj
          </Button>
        </div>
      </header>
      <EnvBanner />

      <main className="mx-auto max-w-7xl px-6 py-6">
        <Tabs defaultValue="queue">
          {/* „Dodaj punkt" to AKCJA, nie widok — przycisk przy tabach, nie tab. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="queue">Kolejka ({queueTotal})</TabsTrigger>
              <TabsTrigger value="content">Wszystkie treści</TabsTrigger>
              <TabsTrigger value="blocked">Zablokowani</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              className="gap-1 bg-green-600 text-white hover:bg-green-700"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Dodaj punkt
            </Button>
          </div>

          <TabsContent value="queue" className="space-y-6 pt-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-foreground"
                checked={hideTest}
                onChange={(e) => setHideTest(e.target.checked)}
              />
              Ukryj testowe
            </label>
            <QueueComments items={comments} error={commentsErr} hideTest={hideTest} />
            <QueueDescriptions items={descs} error={descsErr} hideTest={hideTest} />
            <QueueReports items={reports} error={reportsErr} hideTest={hideTest} />
          </TabsContent>

          <TabsContent value="content" className="pt-4">
            <ContentTab />
          </TabsContent>

          <TabsContent value="blocked" className="pt-4">
            <BlockedTab />
          </TabsContent>
        </Tabs>
      </main>

      <AddPointDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
