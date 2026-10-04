/**
 * Types de logement (« typologies ») : lecture des pages publiques iBail et
 * filtrage des alertes par type / surface / loyer.
 *
 * L'API ARPEJ ne dit que « N places dans la résidence ». Le détail par type
 * (« Comfort Studio · 1 disponible · 29–38 m² · 602–704 € ») n'existe que sur
 * iBail, en pages publiques (sans compte) :
 *   1. arpej.fr/fr/residence/<slug>/  → bouton « Je dépose mon dossier »
 *      → https://ibail.arpej.fr/residences/<CODE>/reservation-d-un-logement
 *   2. page de réservation → mois proposés : /residences/<id>/offers?month=M&year=Y
 *   3. chaque page « offers » → une carte par type (h3 = nom, badge « N disponible(s) »,
 *      dt/dd Surface / Loyer TTC, lien availability_id).
 *
 * Parsing = fonctions PURES (testées sur des pages réelles, test/fixtures/).
 */
import { ARPEJ_SITE, decodeEntities } from "./arpej";
import { getDb } from "./db";

export const IBAIL_SITE = (process.env.IBAIL_PUBLIC_URL || "https://ibail.arpej.fr").replace(/\/+$/, "");

export interface Offer {
  /** Nom affiché (« Comfort Studio »). */
  name: string;
  /** Clé normalisée pour comparer (« comfort studio »). */
  key: string;
  description: string;
  /** Places disponibles pour ce type, ce mois-ci. */
  available: number;
  surfaceMin: number | null;
  surfaceMax: number | null;
  rentMin: number | null;
  rentMax: number | null;
  availabilityId: string | null;
  /** Mois d'entrée « YYYY-MM ». */
  month: string;
}

export interface WatchFilters {
  /** Clés de types acceptés ; vide = tous. */
  types: string[];
  /**
   * Surface minimale (m²) propre à la résidence. null = celle du compte
   * (réglage général) ; 0 = « peu importe » même si le compte a un minimum.
   */
  minSurface: number | null;
  /** Loyer TTC maximal (€) ; null = pas de maximum. */
  maxRent: number | null;
}

// ── Utilitaires purs ──────────────────────────────────────────────────

export function typeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** « 1 234,56 » → 1234.56 */
function num(s: string): number | null {
  const n = Number(s.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** « De 29,2 à 38,4 m2 » → [29.2, 38.4] ; « 19,0 m2 » → [19, 19]. */
export function parseRange(s: string): [number | null, number | null] {
  const nums = (s.match(/\d[\d\s  ]*(?:[.,]\d+)?/g) ?? [])
    .map((x) => num(x))
    .filter((x): x is number => x !== null);
  // « m2 » (exposant) laisse un « 2 » final isolé : on l'ignore pour les surfaces.
  const cleaned = /m\s*2\s*$/i.test(s.replace(/<[^>]*>/g, "")) && nums.length > 0 ? nums.slice(0, -1) : nums;
  if (cleaned.length === 0) return [null, null];
  return [Math.min(...cleaned.slice(0, 2)), Math.max(...cleaned.slice(0, 2))];
}

/** Code iBail de la résidence depuis sa page arpej.fr (lien « Je dépose mon dossier »). */
export function findIbailCode(arpejHtml: string): string | null {
  const m = arpejHtml.match(/ibail\.arpej\.fr\/residences\/([A-Za-z0-9_-]+)\//);
  return m ? m[1] : null;
}

/** Page de réservation iBail → id numérique + mois proposés. */
export function parseReservationPage(html: string): {
  residenceId: string | null;
  months: Array<{ month: number; year: number }>;
} {
  const re = /\/residences\/(\d+)\/offers\?month=(\d{1,2})&(?:amp;)?year=(\d{4})/g;
  let residenceId: string | null = null;
  const seen = new Set<string>();
  const months: Array<{ month: number; year: number }> = [];
  for (const m of html.matchAll(re)) {
    residenceId ??= m[1];
    const key = `${m[3]}-${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ month: Number(m[2]), year: Number(m[3]) });
  }
  return { residenceId, months };
}

/** Page « offers » iBail → une entrée par carte de type de logement. */
export function parseOffers(html: string, month: string): Offer[] {
  const frame = html.match(/<turbo-frame id="offers">([\s\S]*?)<\/turbo-frame>/)?.[1] ?? html;
  const parts = frame.split(/<h3\b/i).slice(1);
  const out: Offer[] = [];
  for (const part of parts) {
    const name = text(part.slice(part.indexOf(">") + 1, part.search(/<\/h3>/i)));
    if (!name) continue;
    const description = text(part.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const available = Number(text(part).match(/(\d+)\s+disponibles?/i)?.[1] ?? 0);
    let surface: [number | null, number | null] = [null, null];
    let rent: [number | null, number | null] = [null, null];
    for (const d of part.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
      const label = text(d[1]).toLowerCase();
      if (label.startsWith("surface")) surface = parseRange(d[2]);
      else if (label.startsWith("loyer")) rent = parseRange(text(d[2]));
    }
    out.push({
      name,
      key: typeKey(name),
      description,
      available,
      surfaceMin: surface[0],
      surfaceMax: surface[1],
      rentMin: rent[0],
      rentMax: rent[1],
      availabilityId: part.match(/availability_id=(\d+)/)?.[1] ?? null,
      month,
    });
  }
  return out;
}

// ── Filtres ───────────────────────────────────────────────────────────

export function hasFilters(f?: WatchFilters | null): f is WatchFilters {
  return !!f && (f.types.length > 0 || f.minSurface !== null || f.maxRent !== null);
}

/** Valide/normalise des filtres venus du client. null = invalide. */
export function normalizeFilters(raw: unknown): WatchFilters | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const types = Array.isArray(r.types)
    ? [...new Set(r.types.map((t) => typeKey(String(t))).filter(Boolean))].slice(0, 20)
    : [];
  const pos = (v: unknown, max: number): number | null | undefined => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 10) / 10 : undefined;
  };
  const minSurface = r.minSurface === 0 || r.minSurface === "0" ? 0 : pos(r.minSurface, 500);
  const maxRent = pos(r.maxRent, 10_000);
  if (minSurface === undefined || maxRent === undefined) return null;
  return { types, minSurface, maxRent };
}

/** Filtres réellement appliqués : minimum de la résidence, sinon celui du compte. */
export function effectiveFilters(
  f: WatchFilters | null | undefined,
  userMinSurface: number | null | undefined,
): WatchFilters | null {
  const eff: WatchFilters = {
    types: f?.types ?? [],
    minSurface: f?.minSurface ?? userMinSurface ?? null,
    maxRent: f?.maxRent ?? null,
  };
  if (eff.minSurface === 0) eff.minSurface = null;
  return hasFilters(eff) ? eff : null;
}

/** Types dispo qui correspondent aux filtres (bornes inconnues = on laisse passer). */
export function matchingOffers(offers: Offer[], f: WatchFilters): Offer[] {
  return offers.filter(
    (o) =>
      o.available > 0 &&
      (f.types.length === 0 || f.types.includes(o.key)) &&
      (f.minSurface === null || (o.surfaceMax ?? o.surfaceMin ?? Infinity) >= f.minSurface) &&
      (f.maxRent === null || (o.rentMin ?? o.rentMax ?? 0) <= f.maxRent),
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n)));
function range(a: number | null, b: number | null, unit: string): string | null {
  if (a === null && b === null) return null;
  if (a === null || b === null || Math.round(a) === Math.round(b)) return `${fmt((a ?? b)!)} ${unit}`;
  return `${fmt(a)}–${fmt(b)} ${unit}`;
}

/** « 1 Comfort Studio (29–38 m², 602–704 €) » */
export function describeOffer(o: Offer): string {
  const bits = [range(o.surfaceMin, o.surfaceMax, "m²"), range(o.rentMin, o.rentMax, "€")].filter(Boolean);
  return `${o.available} ${o.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** Résumé lisible des filtres : « Comfort Studio · ≥ 25 m² · ≤ 650 € ». */
export function describeFilters(f: WatchFilters, names?: Map<string, string>): string {
  if (!hasFilters(f)) return "Tous les logements";
  const parts: string[] = [];
  if (f.types.length) parts.push(f.types.map((k) => names?.get(k) ?? k).join(", "));
  if (f.minSurface !== null) parts.push(`≥ ${f.minSurface} m²`);
  if (f.maxRent !== null) parts.push(`≤ ${f.maxRent} €`);
  return parts.join(" · ");
}

// ── Accès réseau (pages publiques) + cache Mongo ──────────────────────

const CODES = "ibail_residences";
const CATALOG = "typologies";
const NEG_TTL_MS = 6 * 3_600_000;

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; skan/1.0)", "Accept-Language": "fr-FR" },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: res.status === 200 ? (await res.text()).slice(0, 1_000_000) : "" };
}

export function ibailReservationUrl(code: string): string {
  return `${IBAIL_SITE}/residences/${code}/reservation-d-un-logement`;
}

/** Code iBail d'une résidence (mis en cache ; null si introuvable pour l'instant). */
export async function resolveIbailCode(slug: string): Promise<string | null> {
  const db = await getDb();
  const coll = db.collection<{ _id: string; code: string | null; checkedAt: Date }>(CODES);
  const cached = await coll.findOne({ _id: slug });
  if (cached?.code) return cached.code;
  if (cached && Date.now() - cached.checkedAt.getTime() < NEG_TTL_MS) return null;
  const page = await get(`${ARPEJ_SITE}/fr/residence/${slug}/`);
  const code = page.status === 200 ? findIbailCode(page.body) : null;
  await coll.updateOne({ _id: slug }, { $set: { code, checkedAt: new Date() } }, { upsert: true });
  return code;
}

export interface ResidenceOffers {
  slug: string;
  code: string;
  url: string;
  offers: Offer[];
  fetchedAt: Date;
}

/** Lit tous les types dispo (tous mois confondus) d'une résidence. null = impossible à lire. */
export async function fetchResidenceOffers(slug: string): Promise<ResidenceOffers | null> {
  try {
    const code = await resolveIbailCode(slug);
    if (!code) return null;
    const url = ibailReservationUrl(code);
    const page = await get(url);
    if (page.status !== 200) return null;
    const { residenceId, months } = parseReservationPage(page.body);
    const offers: Offer[] = [];
    if (residenceId) {
      for (const { month, year } of months.slice(0, 6)) {
        const r = await get(`${IBAIL_SITE}/residences/${residenceId}/offers?month=${month}&year=${year}`);
        if (r.status !== 200) return null;
        offers.push(...parseOffers(r.body, `${year}-${String(month).padStart(2, "0")}`));
      }
    }
    await recordCatalog(slug, offers).catch((e) => console.error("[typologies] catalogue:", e));
    return { slug, code, url, offers, fetchedAt: new Date() };
  } catch (e) {
    console.error(`[typologies] ${slug}:`, (e as Error).message);
    return null;
  }
}

/** Fusionne les offres par type (plusieurs mois → une ligne par type, places additionnées). */
export function mergeByType(offers: Offer[]): Offer[] {
  const by = new Map<string, Offer>();
  for (const o of offers) {
    const cur = by.get(o.key);
    if (!cur) {
      by.set(o.key, { ...o });
      continue;
    }
    cur.available += o.available;
    const lo = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
    const hi = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
    cur.surfaceMin = lo(cur.surfaceMin, o.surfaceMin);
    cur.surfaceMax = hi(cur.surfaceMax, o.surfaceMax);
    cur.rentMin = lo(cur.rentMin, o.rentMin);
    cur.rentMax = hi(cur.rentMax, o.rentMax);
    if (o.month < cur.month) cur.month = o.month;
  }
  return [...by.values()];
}

export interface CatalogEntry {
  slug: string;
  key: string;
  name: string;
  description: string;
  surfaceMin: number | null;
  surfaceMax: number | null;
  rentMin: number | null;
  rentMax: number | null;
  lastSeenAt: Date;
}

/** Mémorise les types vus par résidence (pour les proposer même quand c'est complet). */
async function recordCatalog(slug: string, offers: Offer[]): Promise<void> {
  if (offers.length === 0) return;
  const db = await getDb();
  await db.collection<CatalogEntry>(CATALOG).bulkWrite(
    mergeByType(offers).map((o) => ({
      updateOne: {
        filter: { slug, key: o.key },
        update: {
          $set: {
            name: o.name,
            description: o.description,
            surfaceMin: o.surfaceMin,
            surfaceMax: o.surfaceMax,
            rentMin: o.rentMin,
            rentMax: o.rentMax,
            lastSeenAt: new Date(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function getCatalog(slug: string): Promise<CatalogEntry[]> {
  const db = await getDb();
  return db
    .collection<CatalogEntry>(CATALOG)
    .find({ slug }, { projection: { _id: 0 } })
    .sort({ surfaceMin: 1, name: 1 })
    .toArray();
}

export async function ensureTypologyIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection(CATALOG).createIndex({ slug: 1, key: 1 }, { unique: true });
}

const globalForOffers = globalThis as unknown as {
  _skanOffers?: Map<string, { at: number; data: ResidenceOffers | null }>;
};

/** Version avec cache mémoire court (affichage UI : évite de marteler iBail). */
export async function getResidenceOffersCached(slug: string, ttlMs = 120_000): Promise<ResidenceOffers | null> {
  globalForOffers._skanOffers ??= new Map();
  const hit = globalForOffers._skanOffers.get(slug);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fetchResidenceOffers(slug);
  globalForOffers._skanOffers.set(slug, { at: Date.now(), data });
  return data;
}
