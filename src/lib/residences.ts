/**
 * Cache mémoire court (60 s) au-dessus de l'API ARPEJ, pour ne pas la
 * solliciter à chaque affichage du dashboard. Le poller, lui, lit en frais.
 */
import { fetchAllResidences, type Residence } from "./arpej";

const TTL_MS = 60_000;

const globalForCache = globalThis as unknown as {
  _skanResCache?: { at: number; data: Residence[] };
};

export async function getResidencesCached(): Promise<Residence[]> {
  const now = Date.now();
  const cache = globalForCache._skanResCache;
  if (cache && now - cache.at < TTL_MS) return cache.data;
  const data = await fetchAllResidences();
  globalForCache._skanResCache = { at: now, data };
  return data;
}

export function invalidateResidencesCache(): void {
  globalForCache._skanResCache = undefined;
}
