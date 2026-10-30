"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  createPoint,
  duplicatesOf,
  editPoint,
  type DescriptionItem,
  type DuplicateHit,
  type PointCreateFields,
  type PointEditFields,
} from "@/lib/moderation";
import { PL_BBOX, mapLink, parseLatLon, toNumber } from "@/lib/coords";
import { TAXONOMY_OPTIONS } from "@/lib/taxonomy";
import { formatPhoneDisplay } from "@/lib/phone";

// Podgląd numeru w kształcie, w jakim wyrenderuje go apka. Pole zostaje SUROWE —
// panel niczego nie przepisuje w bazie, bo numer pochodzi ze źródła (OSM, rejestr)
// i przepisanie go przy każdej edycji punktu zacierałoby ten zapis. Reguła formatu
// jest kopią `lib/core/models/phone_number.dart` z apki — patrz `@/lib/phone`.
function PhonePreview({ value }: { value: string }) {
  const trimmed = value.trim();
  // ⛔ Wpis bez ani jednej cyfry NIE dojdzie do apki: serwerowy `sanitizePhone`
  // rzuca, a apkowy `normalizePhone` zwraca null i wiersz telefonu w ogóle się nie
  // renderuje. Podgląd musi wtedy MILCZEĆ — pokazanie „W apce: ---" obiecywałoby
  // moderatorowi ekran, którego nigdy nie będzie.
  if (!trimmed || !/\d/.test(trimmed)) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      W apce:{" "}
      <span className="font-medium text-foreground">{formatPhoneDisplay(trimmed)}</span>
    </span>
  );
}

// Formularz kuratorskiej edycji punktu. Wysyła tylko ZMIENIONE pola (callable wymaga
// ≥1). Zmiana nazwy/opisu → serwer zapisuje approved + contentHash (bez re-moderacji).
function PointEditForm({ point, onDone, onSaved }: { point: DescriptionItem; onDone: () => void; onSaved?: () => void }) {
  const [name, setName] = useState(point.name ?? "");
  const [description, setDescription] = useState(point.description ?? "");
  const [type, setType] = useState(point.type ?? "");
  const [lat, setLat] = useState(point.lat?.toString() ?? "");
  const [lon, setLon] = useState(point.lon?.toString() ?? "");
  const [phone, setPhone] = useState(point.phone ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const fields: PointEditFields = {};
    if (name.trim() !== (point.name ?? "")) fields.name = name.trim() || null;
    if (description.trim() !== (point.description ?? "")) {
      fields.description = description.trim() || null;
    }
    if (type !== point.type) fields.type = type;
    if (!point.inAsset) {
      if (lat.trim() !== "" && toNumber(lat) !== point.lat) {
        const v = toNumber(lat);
        if (!Number.isFinite(v)) return toast.error("Szerokość: nieprawidłowa liczba");
        fields.lat = v;
      }
      if (lon.trim() !== "" && toNumber(lon) !== point.lon) {
        const v = toNumber(lon);
        if (!Number.isFinite(v)) return toast.error("Długość: nieprawidłowa liczba");
        fields.lon = v;
      }
    }
    // Pusty input = czyszczenie numeru (null w dokumencie). Format waliduje
    // callable (sanitizePhone) — panel nie duplikuje reguł.
    if (phone.trim() !== (point.phone ?? "")) fields.phone = phone.trim() || null;
    if (Object.keys(fields).length === 0) return toast("Brak zmian do zapisania");
    setSaving(true);
    try {
      await editPoint(point.pointId, fields, reason.trim());
      toast.success("Punkt zaktualizowany");
      onSaved?.();
      onDone();
    } catch (e) {
      toast.error("Nie udało się: " + (e instanceof Error ? e.message : "błąd"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Nazwa</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Kategoria</span>
          <Select value={type} onValueChange={(v) => setType(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Wybierz typ" /></SelectTrigger>
            <SelectContent>
              {TAXONOMY_OPTIONS.map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Opis</span>
        <textarea
          className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {point.inAsset ? (
        <p className="text-xs text-muted-foreground">
          Pozycja {point.lat}, {point.lon} pochodzi z bazy punktów. Z panelu się jej nie
          zmienia, bo apka i tak wzięłaby ją z bazy.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Szerokość (lat)</span>
            <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Długość (lon)</span>
            <Input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
          </label>
        </div>
      )}
      <label className="block space-y-1 text-sm sm:max-w-xs">
        <span className="text-muted-foreground">Telefon (opcjonalny)</span>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="+48 902 092 012"
        />
        <PhonePreview value={phone} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Powód zmiany (opcjonalny, zostaje w historii)</span>
        <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz zmiany"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>Anuluj</Button>
      </div>
    </div>
  );
}

// Edycja punktu zawsze w modalu (decyzja UX 0721) — bez rozwijania wierszy
// tabeli; Esc/backdrop/Anuluj zamykają bez zapisu.
export function PointEditDialog({ point, onClose, onSaved }: { point: DescriptionItem | null; onClose: () => void; onSaved?: () => void }) {
  return (
    <Dialog open={point !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {point && (
        <DialogContent>
          <DialogTitle>Edytuj punkt — {point.name || point.pointId}</DialogTitle>
          <PointEditForm point={point} onDone={onClose} onSaved={onSaved} />
        </DialogContent>
      )}
    </Dialog>
  );
}

// ── Ręczne dodawanie punktu ──────────────────────────────────────────────────

/**
 * Formularz ręcznego dodania punktu (nazwa/kategoria/współrzędne/opis) —
 * w modalu pod przyciskiem „Dodaj punkt" przy tabach. Punkt idzie przez callable
 * `onModeratorCreatePoint` i jest widoczny w apce od razu (UGC, approved) — bez
 * czekania na moderację i bez wydania nowej wersji. Formularz po zapisie czyści
 * treść, ale ZOSTAWIA kategorię (modal zostaje otwarty): wpisywanie
 * serii punktów tego samego typu to główny scenariusz (import z listy adresów).
 * Dodane punkty widać w „Wszystkie treści" jako „Nowy punkt".
 */
function AddPointForm() {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  // Kolizje z ostatniej próby. Dodanie mimo nich wymaga świadomego kliknięcia.
  const [duplicates, setDuplicates] = useState<DuplicateHit[] | null>(null);

  // Wklejenie pary („49.412, 20.712" lub link z mapy) w pole szerokości rozbija
  // się na oba pola — przy przepisywaniu z listy to najczęstszy ruch.
  function onLatPaste(text: string) {
    const parsed = parseLatLon(text);
    if (!parsed) return false;
    setLat(String(parsed.lat));
    setLon(String(parsed.lon));
    return true;
  }

  const latNum = toNumber(lat);
  const lonNum = toNumber(lon);
  const coordsOk =
    lat.trim() !== "" && lon.trim() !== "" &&
    Number.isFinite(latNum) && Number.isFinite(lonNum) &&
    latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
  const outsidePl = coordsOk && (
    latNum < PL_BBOX.latMin || latNum > PL_BBOX.latMax ||
    lonNum < PL_BBOX.lonMin || lonNum > PL_BBOX.lonMax
  );
  const canSubmit = name.trim() !== "" && type !== "" && coordsOk && !saving;

  async function submit(force = false) {
    if (!canSubmit) return;
    const fields: PointCreateFields = { name: name.trim(), type, lat: latNum, lon: lonNum };
    if (description.trim() !== "") fields.description = description.trim();
    if (phone.trim() !== "") fields.phone = phone.trim();
    setSaving(true);
    try {
      await createPoint(fields, force);
      toast.success("Punkt dodany — widoczny w apce");
      // Treść czyścimy, kategorię zostawiamy pod kolejny punkt z serii.
      // Telefon też czyścimy — numer jest per-punkt, nie per-seria.
      setName("");
      setLat("");
      setLon("");
      setDescription("");
      setPhone("");
      setDuplicates(null);
    } catch (e) {
      const hits = duplicatesOf(e);
      if (hits) setDuplicates(hits);
      else toast.error("Nie udało się dodać: " + (e instanceof Error ? e.message : "błąd"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
        <p className="mb-3 text-xs text-muted-foreground">
          Punkt trafia do bazy jako wpis moderatora (podpis „Zespół Hyc!”) i jest widoczny
          w aplikacji od razu — bez kolejki moderacji. Opis jest opcjonalny; bez niego apka
          pokaże przy punkcie zaproszenie „Zostań pionierem”.
        </p>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Nazwa *</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="np. Bacówka nad Wierchomlą"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Kategoria *</span>
              <Select value={type} onValueChange={(v) => setType(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Wybierz kategorię" /></SelectTrigger>
                <SelectContent>
                  {TAXONOMY_OPTIONS.map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Szerokość (lat) *</span>
              <Input
                value={lat}
                inputMode="decimal"
                placeholder="49.412 — można wkleić parę albo link z mapy"
                onChange={(e) => { if (!onLatPaste(e.target.value)) setLat(e.target.value); }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Długość (lon) *</span>
              <Input
                value={lon}
                inputMode="decimal"
                placeholder="20.712"
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
          </div>
          {lat.trim() !== "" && lon.trim() !== "" && !coordsOk && (
            <p className="text-xs text-red-600">Współrzędne nieprawidłowe — sprawdź liczby.</p>
          )}
          {outsidePl && (
            <p className="text-xs text-amber-600">
              Uwaga: punkt leży poza Polską i pasem 50 km — czy szerokość z długością nie są
              zamienione miejscami?
            </p>
          )}
          {coordsOk && (
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
              href={mapLink(latNum, lonNum)}
              target="_blank"
              rel="noreferrer"
            >
              Sprawdź na mapie <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Opis (opcjonalny)</span>
            <textarea
              className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Co user zastanie na miejscu"
            />
          </label>

          <label className="block space-y-1 text-sm sm:max-w-xs">
            <span className="text-muted-foreground">Telefon (opcjonalny)</span>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+48 902 092 012"
            />
            <PhonePreview value={phone} />
          </label>

          {duplicates && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Taki punkt może już istnieć:</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {duplicates.slice(0, 5).map((d, i) => (
                  <li key={d.id ?? i}>
                    {d.name || "(bez nazwy)"}, {d.dist_m} m ({d.why})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                Jeśli to ten sam obiekt, popraw istniejący punkt w zakładce Punkty.
              </p>
              <Button size="sm" variant="outline" className="mt-2" disabled={saving} onClick={() => submit(true)}>
                To osobny obiekt, dodaj mimo to
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => submit()} disabled={!canSubmit}>
              {saving ? "Dodawanie…" : "Dodaj punkt"}
            </Button>
            <span className="text-xs text-muted-foreground">* pola wymagane</span>
          </div>
        </div>
    </div>
  );
}

// Modal „Dodaj punkt" — zostaje otwarty po zapisie (seria punktów); Esc/backdrop
// zamykają. Stan formularza żyje w AddPointForm, więc zamknięcie modala go zeruje.
export function AddPointDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {open && (
        <DialogContent>
          <DialogTitle>Nowy punkt</DialogTitle>
          <AddPointForm />
        </DialogContent>
      )}
    </Dialog>
  );
}
