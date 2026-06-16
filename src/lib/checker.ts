/**
 * Logique pure de détection des nouvelles disponibilités.
 *
 * Aucune dépendance réseau / base : prend l'état persisté des surveillances
 * et la liste live des résidences, renvoie les alertes à émettre + le nouvel
 * état à persister. Facilement testable.
 */

import type { Residence } from "./arpej";

/** État persisté d'une résidence surveillée. */
export interface WatchRecord {
  slug: string;
  title: string;
  link: string;
  /** La résidence était-elle disponible au dernier check ? */
  lastAvailable: boolean;
  lastAvailableRooms: number;
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
}

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
