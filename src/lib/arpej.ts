/**
 * Client de l'API publique ARPEJ.
 *
 * Endpoint : GET https://www.arpej.fr/wp-json/sn/residences?page=N
 * Réponse  : { residences: RawResidence[], total: number, pages: number }
 *
 * Particularité clé : l'API ne liste QUE les résidences réservables
 * (available_rooms >= 1). Une résidence absente de la liste = 0 logement
 * disponible. C'est sur cette présence/absence que repose la détection.
 */

const ARPEJ_ENDPOINT = "https://www.arpej.fr/wp-json/sn/residences";

export interface Residence {
  id: number;
  slug: string;
  title: string;
  link: string;
  city: string;
  zipCode: string;
  priceFrom: number | null;
  availableRooms: number;
  isBookable: boolean;
  image: string | null;
}

interface RawResidence {
  ID: number;
  title: string;
  link: string;
  extra_data?: {
    city?: string;
    zip_code?: string;
    price_from?: string | number;
    available_rooms?: number;
    is_bookable?: boolean | string;
    images?: Array<{ url?: string }>;
  };
}

interface RawPage {
  residences: RawResidence[];
  total: number;
  pages: number;
}

/** Extrait le slug stable depuis le lien (.../fr/residence/<slug>/). */
export function slugFromLink(link: string): string {
  const m = link.match(/\/residence\/([^/?#]+)/);
  return m ? m[1] : link;
}

function mapResidence(r: RawResidence): Residence {
  const e = r.extra_data ?? {};
  const image =
    Array.isArray(e.images) && e.images.length > 0 ? e.images[0]?.url ?? null : null;
  return {
    id: r.ID,
    slug: slugFromLink(r.link),
    title: (r.title ?? "").trim(),
    link: r.link,
    city: e.city ?? "",
    zipCode: e.zip_code ?? "",
    priceFrom:
      e.price_from !== undefined && e.price_from !== "" ? Number(e.price_from) : null,
    availableRooms: Number(e.available_rooms ?? 0),
    isBookable: e.is_bookable === true || e.is_bookable === "true",
    image,
  };
}

/**
 * Récupère toutes les résidences réservables (toutes les pages).
 * @throws si l'API répond avec un statut non-2xx.
 */
export async function fetchAllResidences(): Promise<Residence[]> {
  const out: Residence[] = [];
  let page = 1;
  let pages = 1;

  do {
    const res = await fetch(`${ARPEJ_ENDPOINT}?page=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; skan/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`ARPEJ API a répondu ${res.status} (page ${page})`);
    }
    const data = (await res.json()) as RawPage;
    pages = Number(data.pages) || 1;
    for (const r of data.residences ?? []) {
      out.push(mapResidence(r));
    }
    page += 1;
  } while (page <= pages);

  return out;
}
