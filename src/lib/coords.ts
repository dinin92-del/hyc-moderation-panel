export function mapLink(lat: number | null, lon: number | null): string | undefined {
  if (lat === null || lon === null) return undefined;
  return `https://mapy.cz/turisticka?x=${lon}&y=${lat}&z=16`;
}

/** Bounding box PL + pas 50 km (zasięg danych). Poza nim = ostrzeżenie, nie blokada. */
export const PL_BBOX = { latMin: 48.4, latMax: 55.5, lonMin: 13.3, lonMax: 25.0 };

export function toNumber(v: string): number {
  // „49,412" (przecinek dziesiętny) i „49.412," (ogon po wklejeniu pary).
  return Number(v.trim().replace(/,$/, "").replace(",", "."));
}

/**
 * Wyłuskuje parę współrzędnych z jednego wklejenia: „49.412, 20.712",
 * „49,412 20,712", link Google Maps (`@lat,lon` / `?q=lat,lon`) albo mapy.cz
 * (`x=lon&y=lat`). Zwraca null, gdy nie da się odczytać pary liczb.
 */
export function parseLatLon(raw: string): { lat: number; lon: number } | null {
  const s = raw.trim();
  if (!s) return null;
  const inRange = (lat: number, lon: number) =>
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  const g = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (g) return inRange(Number(g[1]), Number(g[2]));
  const mx = s.match(/[?&]x=(-?\d+\.\d+)/);
  const my = s.match(/[?&]y=(-?\d+\.\d+)/);
  if (mx && my) return inRange(Number(my[1]), Number(mx[1])); // mapy.cz: x=lon, y=lat
  const parts = /[\s;]/.test(s) ? s.split(/[\s;]+/) : s.split(",");
  if (parts.length !== 2) return null;
  // Bez części dziesiętnej to nie współrzędne, tylko np. „602 123" z numeru telefonu.
  if (!parts.every((part) => /^-?\d+[.,]\d+,?$/.test(part))) return null;
  return inRange(toNumber(parts[0]), toNumber(parts[1]));
}
