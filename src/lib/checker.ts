/**
 * Logique pure de détection des nouvelles disponibilités.
 *
 * Aucune dépendance réseau / base : prend l'état persisté des surveillances
 * et la liste live des résidences, renvoie les alertes à émettre + le nouvel
 * état à persister. Facilement testable.
 */

import type { Residence } from "./arpej";
import { hasFilters, matchingOffers, mergeByType, type Offer, type WatchFilters } from "./typologies";

/** État persisté d'une résidence surveillée. */
export interface WatchRecord {
  slug: string;
  title: string;
  link: string;
  /** La résidence était-elle disponible au dernier check ? */
  lastAvailable: boolean;
  lastAvailableRooms: number;
  /** Filtres par type / surface / loyer (absent = toute place compte). */
  filters?: WatchFilters | null;
}

/** Statut courant calculé pour une résidence surveillée. */
export interface ResidenceStatus {
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  available: boolean;
}

/** Événement d'alerte (transition indisponible -> disponible). */
export interface AlertEvent {
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  /** Types de logement dispo qui déclenchent l'alerte (si connus). */
  offers?: Offer[];
  /** Lien direct iBail de la résidence (si connu). */
  bookingUrl?: string;
  /** Filtres actifs mais types illisibles (iBail injoignable) : alerte par prudence. */
  unverified?: boolean;
}

/** Types dispo d'une résidence (lus sur iBail) ; null = lecture impossible. */
export type OffersBySlug = Map<string, { url: string; offers: Offer[] } | null>;

export interface CheckResult {
  /** Statut courant par slug surveillé. */
  statuses: ResidenceStatus[];
  /** Alertes à émettre maintenant. */
  alerts: AlertEvent[];
  /** Nouvel état à persister pour chaque surveillance. */
  updates: WatchRecord[];
}

/** Calcule le statut courant d'un slug à partir de la liste live (absent => 0). */
export function statusForSlug(
  slug: string,
  bySlug: Map<string, Residence>,
  fallbackTitle: string,
): ResidenceStatus {
  const r = bySlug.get(slug);
  const rooms = r ? r.availableRooms : 0;
  return {
    slug,
    title: r?.title || fallbackTitle || slug,
    link: r?.link || `https://www.arpej.fr/fr/residence/${slug}/`,
    availableRooms: rooms,
    available: rooms > 0,
  };
}

/**
 * Compare l'état persisté aux disponibilités live.
 * Émet une alerte uniquement sur la transition `indisponible -> disponible`
 * (anti-spam : pas de re-notification tant que ça reste disponible).
 */
export function computeAlerts(
  watches: WatchRecord[],
  residences: Residence[],
): CheckResult {
  const bySlug = new Map(residences.map((r) => [r.slug, r]));
  const alerts: AlertEvent[] = [];
  const updates: WatchRecord[] = [];
  const statuses: ResidenceStatus[] = [];

  for (const w of watches) {
    const st = statusForSlug(w.slug, bySlug, w.title);
    statuses.push(st);

    if (st.available && !w.lastAvailable) {
      alerts.push({
        slug: st.slug,
        title: st.title,
        link: st.link,
        availableRooms: st.availableRooms,
      });
    }

    updates.push({
      slug: w.slug,
      title: st.title,
      link: st.link,
      lastAvailable: st.available,
      lastAvailableRooms: st.availableRooms,
    });
  }

  return { statuses, alerts, updates };
}

/**
 * Comme computeAlerts, en tenant compte des filtres de chaque surveillance.
 * - Sans filtre : transition « résidence indisponible → disponible » (inchangé),
 *   l'alerte est enrichie du détail par type quand il est connu.
 * - Avec filtres : `lastAvailable` mémorise « un logement CORRESPONDANT est dispo » ;
 *   on alerte quand ça passe à vrai (ex. un Comfort Studio s'ouvre alors qu'un
 *   19 m² non voulu était déjà libre). Si iBail est illisible, on alerte quand
 *   même (marqué « non vérifié ») : mieux vaut une alerte de trop qu'une place ratée.
 */
export function computeFilteredAlerts(
  watches: WatchRecord[],
  residences: Residence[],
  offersBySlug: OffersBySlug,
): CheckResult {
  const bySlug = new Map(residences.map((r) => [r.slug, r]));
  const alerts: AlertEvent[] = [];
  const updates: WatchRecord[] = [];
  const statuses: ResidenceStatus[] = [];

  for (const w of watches) {
    const st = statusForSlug(w.slug, bySlug, w.title);
    statuses.push(st);
    const live = offersBySlug.get(w.slug);

    let match = st.available;
    let offers: Offer[] | undefined;
    let unverified = false;
    if (st.available) {
      if (live) offers = mergeByType(live.offers.filter((o) => o.available > 0));
      if (hasFilters(w.filters)) {
        if (live) {
          offers = mergeByType(matchingOffers(live.offers, w.filters));
          match = offers.length > 0;
        } else {
          unverified = true;
        }
      }
    }

    if (match && !w.lastAvailable) {
      alerts.push({
        slug: st.slug,
        title: st.title,
        link: st.link,
        availableRooms: st.availableRooms,
        ...(offers && offers.length ? { offers } : {}),
        ...(live ? { bookingUrl: live.url } : {}),
        ...(unverified ? { unverified } : {}),
      });
    }

    updates.push({
      slug: w.slug,
      title: st.title,
      link: st.link,
      lastAvailable: match,
      lastAvailableRooms: st.availableRooms,
    });
  }

  return { statuses, alerts, updates };
}
