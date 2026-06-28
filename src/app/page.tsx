"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { StateBadge, StatusBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  decide,
  fetchAllComments,
  fetchAllDescriptions,
  fetchHistory,
  watchCommentsQueue,
  watchDescriptionsQueue,
  watchReportsQueue,
  type CommentItem,
  type DescriptionItem,
  type LogItem,
  type ReportItem,
} from "@/lib/moderation";
import { CATEGORY_LABEL, FLAG_LABEL, TARGET_LABEL, fmtDate } from "@/lib/labels";

export default function Home() {
  return <AuthGate>{({ user, signOut }) => <Panel email={user.email ?? ""} signOut={signOut} />}</AuthGate>;
}

async function act(input: Parameters<typeof decide>[0], okMsg: string, after?: () => void) {
  try {
    await decide(input);
    toast.success(okMsg);
    after?.();
  } catch (e) {
    toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
  }
}

function Panel({ email, signOut }: { email: string; signOut: () => void }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [descs, setDescs] = useState<DescriptionItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);

  useEffect(() => {
    const onErr = () => toast.error("Błąd wczytywania kolejki.");
    const u1 = watchCommentsQueue(setComments, onErr);
    const u2 = watchDescriptionsQueue(setDescs, onErr);
    const u3 = watchReportsQueue(setReports, onErr);
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const queueTotal = comments.length + descs.length + reports.length;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Panel moderatora</h1>
          <p className="text-xs text-muted-foreground">Hyc do Budy · {email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono">
            Kolejka: {queueTotal}
          </Badge>
          <Button variant="outline" size="sm" onClick={signOut}>
            Wyloguj
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger value="queue">Kolejka ({queueTotal})</TabsTrigger>
            <TabsTrigger value="history">Historia decyzji</TabsTrigger>
            <TabsTrigger value="content">Wszystkie treści</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-8 pt-4">
            <QueueComments items={comments} />
            <QueueDescriptions items={descs} />
            <QueueReports items={reports} />
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <HistoryTab />
          </TabsContent>

          <TabsContent value="content" className="pt-4">
            <ContentTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title} <span className="font-mono">({count})</span>
      </h2>
      <div className="overflow-hidden rounded-lg border bg-background">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-4 py-6 text-sm text-muted-foreground">{text}</div>;
}

function confirmReject(what: string) {
  return window.confirm(`Odrzucić ${what}? Treść zostanie ukryta.`);
}

function ApproveReject({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={onApprove}>
        Zatwierdź
      </Button>
      <Button size="sm" variant="destructive" onClick={onReject}>
        Odrzuć
      </Button>
    </div>
  );
}

function QueueComments({ items }: { items: CommentItem[] }) {
  return (
    <Section title="Komentarze do sprawdzenia" count={items.length}>
      {items.length === 0 ? (
        <Empty text="Brak komentarzy do sprawdzenia." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Autor</TableHead>
              <TableHead>Treść</TableHead>
              <TableHead className="w-24">Zgłoszenia</TableHead>
              <TableHead className="w-56 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((c) => (
              <TableRow key={`${c.pointId}/${c.commentId}`}>
                <TableCell className="align-top text-sm">{c.authorName || "Użytkownik"}</TableCell>
                <TableCell className="max-w-md align-top text-sm">{c.text}</TableCell>
                <TableCell className="align-top">
                  {c.reportCount > 0 ? <Badge variant="destructive">{c.reportCount}</Badge> : "—"}
                </TableCell>
                <TableCell className="align-top text-right">
                  <ApproveReject
                    onApprove={() => act({ action: "approveComment", pointId: c.pointId, commentId: c.commentId }, "Zatwierdzono")}
                    onReject={() =>
                      confirmReject("komentarz") &&
                      act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Odrzucono")
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function QueueDescriptions({ items }: { items: DescriptionItem[] }) {
  return (
    <Section title="Opisy do sprawdzenia" count={items.length}>
      {items.length === 0 ? (
        <Empty text="Brak opisów do sprawdzenia." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Punkt</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead className="w-56 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.pointId}>
                <TableCell className="align-top text-sm font-medium">{p.name || p.pointId}</TableCell>
                <TableCell className="max-w-md align-top text-sm">{p.description}</TableCell>
                <TableCell className="align-top text-right">
                  <ApproveReject
                    onApprove={() => act({ action: "approveDescription", pointId: p.pointId }, "Zatwierdzono")}
                    onReject={() =>
                      confirmReject("opis") && act({ action: "rejectDescription", pointId: p.pointId }, "Odrzucono")
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function QueueReports({ items }: { items: ReportItem[] }) {
  return (
    <Section title="Zgłoszenia użytkowników" count={items.length}>
      {items.length === 0 ? (
        <Empty text="Brak otwartych zgłoszeń." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Cel</TableHead>
              <TableHead>Przyczyna</TableHead>
              <TableHead>Powód (tekst)</TableHead>
              <TableHead className="w-56 text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="align-top">
                  <Badge variant="outline">{TARGET_LABEL[r.target] ?? r.target}</Badge>
                </TableCell>
                <TableCell className="align-top text-sm">
                  {r.flag ? FLAG_LABEL[r.flag] ?? r.flag : r.category ? CATEGORY_LABEL[r.category] ?? r.category : "—"}
                </TableCell>
                <TableCell className="max-w-xs align-top text-sm text-muted-foreground">{r.reason || "—"}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act({ action: "closeReport", reportId: r.id, resolution: "actioned" }, "Zamknięto")}
                    >
                      Zasadne
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act({ action: "closeReport", reportId: r.id, resolution: "dismissed" }, "Odrzucono zgł.")}
                    >
                      Odrzuć zgł.
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function HistoryTab() {
  const [rows, setRows] = useState<LogItem[] | null>(null);
  useEffect(() => {
    fetchHistory().then(setRows).catch(() => toast.error("Nie udało się wczytać historii."));
  }, []);

  if (!rows) return <Empty text="Ładowanie…" />;
  return (
    <Section title="Historia decyzji" count={rows.length}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Typ</TableHead>
            <TableHead>Treść</TableHead>
            <TableHead className="w-32">AI</TableHead>
            <TableHead className="w-32">Człowiek</TableHead>
            <TableHead className="w-24">Override</TableHead>
            <TableHead className="w-36">Kiedy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="align-top text-xs text-muted-foreground">{r.targetType}</TableCell>
              <TableCell className="max-w-sm align-top text-sm">{r.text || "—"}</TableCell>
              <TableCell className="align-top">
                {r.ai ? <StateBadge state={r.ai.state} /> : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="align-top">
                {r.human ? <StateBadge state={r.human.state} /> : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="align-top">
                {r.overrodeAI ? <Badge variant="destructive">override</Badge> : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="align-top font-mono text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function ContentTab() {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [descs, setDescs] = useState<DescriptionItem[] | null>(null);
  const load = useCallback(() => {
    fetchAllComments().then(setComments).catch(() => toast.error("Błąd komentarzy."));
    fetchAllDescriptions().then(setDescs).catch(() => toast.error("Błąd opisów."));
  }, []);
  useEffect(load, [load]);

  return (
    <Tabs defaultValue="comments">
      <TabsList>
        <TabsTrigger value="comments">Komentarze ({comments?.length ?? "…"})</TabsTrigger>
        <TabsTrigger value="descs">Opisy ({descs?.length ?? "…"})</TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="pt-4">
        {!comments ? (
          <Empty text="Ładowanie…" />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Autor</TableHead>
                  <TableHead>Treść</TableHead>
                  <TableHead className="w-28">Stan</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-28 text-right">Akcja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comments.map((c) => (
                  <TableRow key={`${c.pointId}/${c.commentId}`}>
                    <TableCell className="align-top text-sm">{c.authorName || "Użytkownik"}</TableCell>
                    <TableCell className="max-w-md align-top text-sm">{c.text}</TableCell>
                    <TableCell className="align-top"><StateBadge state={c.state} /></TableCell>
                    <TableCell className="align-top"><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="align-top text-right">
                      {c.status !== "removed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            confirmReject("komentarz") &&
                            act({ action: "rejectComment", pointId: c.pointId, commentId: c.commentId }, "Odrzucono", load)
                          }
                        >
                          Odrzuć
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
      <TabsContent value="descs" className="pt-4">
        {!descs ? (
          <Empty text="Ładowanie…" />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Punkt</TableHead>
                  <TableHead>Opis</TableHead>
                  <TableHead className="w-28">Stan</TableHead>
                  <TableHead className="w-28 text-right">Akcja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {descs.map((p) => (
                  <TableRow key={p.pointId}>
                    <TableCell className="align-top text-sm font-medium">{p.name || p.pointId}</TableCell>
                    <TableCell className="max-w-md align-top text-sm">{p.description}</TableCell>
                    <TableCell className="align-top"><StateBadge state={p.state} /></TableCell>
                    <TableCell className="align-top text-right">
                      {p.state !== "rejected" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            confirmReject("opis") &&
                            act({ action: "rejectDescription", pointId: p.pointId }, "Odrzucono", load)
                          }
                        >
                          Odrzuć
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
