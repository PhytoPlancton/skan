/**
 * Construit la vue dashboard : toutes les résidences réservables (live) +
 * les surveillances absentes de la liste (donc à 0 logement, ex. Eole),
 * avec leur flag "surveillée".
 */
import { getResidencesCached } from "./residences";
import { listWatches } from "./repo";
import { hasFilters, type WatchFilters } from "./typologies";

export interface DashboardItem {
  slug: string;
  title: string;
  link: string;
  city: string;
  zipCode: string;
  priceFrom: number | null;
  availableRooms: number;
  available: boolean;
  image: string | null;
  watched: boolean;
  /** Filtres de la surveillance (null = tous les logements). */
  filters: WatchFilters | null;
}

export interface Dashboard {
  /** Surface minimale générale du compte (null = peu importe). */
  userMinSurface: number | null;
  items: DashboardItem[];
  total: number;
  availableCount: number;
  watchedCount: number;
  updatedAt: string;
}

export async function getDashboard(userId: string, userMinSurface: number | null = null): Promise<Dashboard> {
  const [residences, watches] = await Promise.all([
    getResidencesCached(),
    listWatches(userId),
  ]);

  const watchedSlugs = new Set(watches.map((w) => w.slug));
  const filtersBySlug = new Map(
    watches.map((w) => [w.slug, hasFilters(w.filters) ? w.filters : null] as const),
  );
  const liveSlugs = new Set(residences.map((r) => r.slug));

  const items: DashboardItem[] = residences.map((r) => ({
    slug: r.slug,
    title: r.title,
    link: r.link,
    city: r.city,
    zipCode: r.zipCode,
    priceFrom: r.priceFrom,
    availableRooms: r.availableRooms,
    available: r.availableRooms > 0,
    image: r.image,
    watched: watchedSlugs.has(r.slug),
    filters: filtersBySlug.get(r.slug) ?? null,
  }));

  // Surveillances qui ne sont pas dans la liste live = 0 logement disponible.
  for (const w of watches) {
    if (!liveSlugs.has(w.slug)) {
      items.push({
        slug: w.slug,
        title: w.title || w.slug,
        link: w.link || `https://www.arpej.fr/fr/residence/${w.slug}/`,
        city: "",
        zipCode: "",
        priceFrom: null,
        availableRooms: 0,
        available: false,
        image: null,
        watched: true,
        filters: filtersBySlug.get(w.slug) ?? null,
      });
    }
  }

  // Surveillées d'abord, puis disponibles, puis par titre.
  items.sort(
    (a, b) =>
      Number(b.watched) - Number(a.watched) ||
      Number(b.available) - Number(a.available) ||
      a.title.localeCompare(b.title, "fr"),
  );

  return {
    userMinSurface,
    items,
    total: residences.length,
    availableCount: residences.filter((r) => r.availableRooms > 0).length,
    watchedCount: watches.length,
    updatedAt: new Date().toISOString(),
  };
}
