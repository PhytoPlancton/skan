/**
 * Construit la vue dashboard : toutes les résidences réservables (live) +
 * les surveillances absentes de la liste (donc à 0 logement, ex. Eole),
 * avec leur flag "surveillée".
 */
import { getResidencesCached } from "./residences";
import { listWatches } from "./repo";

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
}

export interface Dashboard {
  items: DashboardItem[];
  total: number;
  availableCount: number;
  watchedCount: number;
  updatedAt: string;
}

export async function getDashboard(): Promise<Dashboard> {
  const [residences, watches] = await Promise.all([
    getResidencesCached(),
    listWatches(),
  ]);

  const watchedSlugs = new Set(watches.map((w) => w.slug));
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
    items,
    total: residences.length,
    availableCount: residences.filter((r) => r.availableRooms > 0).length,
    watchedCount: watches.length,
    updatedAt: new Date().toISOString(),
  };
}
