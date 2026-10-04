import { requireUser } from "@/lib/current-user";
import { getWatch, setWatchFilters } from "@/lib/repo";
import { getResidencesCached } from "@/lib/residences";
import { isValidSlug } from "@/lib/slug";
import {
  getCatalog,
  getResidenceOffersCached,
  effectiveFilters,
  hasFilters,
  matchingOffers,
  mergeByType,
  normalizeFilters,
} from "@/lib/typologies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Filtres d'une surveillance + de quoi les choisir :
 *  - live    : types dispo en ce moment (lus sur iBail, cache 2 min), ou null si illisible
 *  - catalog : types déjà vus pour cette résidence (même quand elle est complète)
 */
export async function GET(_req: Request, { params }: Ctx) {
  const g = await requireUser();
  if (g.error) return g.error;
  const { slug } = await params;
  if (!isValidSlug(slug)) return Response.json({ error: "slug invalide" }, { status: 400 });
  const watch = await getWatch(g.user._id, slug);
  if (!watch) return Response.json({ error: "résidence non surveillée" }, { status: 404 });

  const [live, catalog] = await Promise.all([
    getResidenceOffersCached(slug).catch(() => null),
    getCatalog(slug).catch(() => []),
  ]);
  return Response.json({
    filters: watch.filters ?? { types: [], minSurface: null, maxRent: null },
    userMinSurface: g.user.minSurface ?? null,
    live: live ? { url: live.url, offers: mergeByType(live.offers) } : null,
    catalog,
  });
}

/** Enregistre les filtres ; la baseline est reposée sur l'état actuel (pas d'alerte immédiate). */
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requireUser();
  if (g.error) return g.error;
  const { slug } = await params;
  if (!isValidSlug(slug)) return Response.json({ error: "slug invalide" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const filters = normalizeFilters(body?.filters);
  if (!filters) {
    return Response.json({ error: "filtres invalides (surface et loyer : nombres positifs)" }, { status: 400 });
  }
  if (!(await getWatch(g.user._id, slug))) {
    return Response.json({ error: "résidence non surveillée" }, { status: 404 });
  }

  const residences = await getResidencesCached().catch(() => []);
  const available = residences.some((r) => r.slug === slug && r.availableRooms > 0);
  let baseline = available;
  const eff = effectiveFilters(filters, g.user.minSurface);
  if (available && eff) {
    const live = await getResidenceOffersCached(slug).catch(() => null);
    if (live) baseline = matchingOffers(live.offers, eff).length > 0;
  }
  const stored = hasFilters(filters) ? filters : null;
  await setWatchFilters(g.user._id, slug, stored, baseline);
  return Response.json({ ok: true, filters: stored ?? { types: [], minSurface: null, maxRent: null } });
}
