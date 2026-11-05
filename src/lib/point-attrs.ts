import type { DescriptionItem, PointBase } from "./moderation";

type AttrSource = Pick<
  DescriptionItem,
  "name" | "type" | "moderatorEdited" | "createdVia" | "description" | "state" | "source"
>;

/**
 * Czy nazwa i typ z dokumentu wygrywają z bazą assetu. Lustro `applyVisibleOverride`
 * (shelter_local_service.dart) i `userOverlayApplies` w functions/moderator_points.js:
 * poprawka moderatora albo opis użytkownika, który wchodzi razem z nazwą i typem
 * (`PointContributionService`). Opis użytkownika liczy się tylko w dokumencie
 * `source: curated`, bo tylko takie nakładki apka czyta. Opis zespołowy ze źródeł
 * (`description-pipeline`) niesie kopię z chwili zapisu, więc baza wygrywa. Opis
 * `rejected` nie jest widoczny nikomu, więc jego nazwa też nie.
 *
 * Świadome odstępstwa dla moderatora, który ocenia treść: widzi też opis `pending`
 * i `needs_review` (apka pokazuje go tylko autorowi), poprawkę moderatora w każdym
 * stanie (apka dopiero po `approved`) i dokument ze `status` innym niż `active`.
 * Bez odwzorowania: `effectiveWaterType` (apka podnosi `woda_niepotwierdzona` do
 * `woda_do_przegotowania` przy widocznym opisie) i aliasy `fromTaxonomyCode`.
 */
export function overlayAttributesApply(
  d: Pick<AttrSource, "moderatorEdited" | "createdVia" | "description" | "state" | "source">,
): boolean {
  return d.moderatorEdited ||
    (d.source === "curated" && d.createdVia !== "description-pipeline" &&
      d.description.trim() !== "" && d.state !== "rejected");
}

/**
 * Nazwa i typ punktu tak, jak widzi go apka. Jedno miejsce dla karty punktu i
 * wierszy list, żeby ten sam punkt nie miał dwóch nazw. Bez bazy (UGC, punkt
 * tylko w Firestore) dokument jest jedynym źródłem.
 */
export function visibleAttrs(
  d: AttrSource,
  base: Pick<PointBase, "name" | "type"> | null,
): { name: string; type: string } {
  if (!base) return { name: d.name, type: d.type };
  const fromDoc = overlayAttributesApply(d);
  return {
    name: fromDoc && d.name.trim() ? d.name : base.name,
    type: fromDoc && d.type.trim() ? d.type : base.type,
  };
}

/**
 * Punkt z assetu tak, jak widzi go apka: nazwa i typ wg [visibleAttrs], pozycja zawsze
 * z assetu (lustro `applyVisibleOverride`). Karta punktu i wiersze list składają
 * punkt tą samą funkcją, więc nie rozjadą się.
 */
export function withAssetBase(d: DescriptionItem, base: PointBase): DescriptionItem {
  return { ...d, ...visibleAttrs(d, base), lat: base.lat, lon: base.lon, base };
}
