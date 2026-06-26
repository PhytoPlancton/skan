/**
 * Orchestrateur d'un cycle de vérification.
 * Utilisé par le poller interne (node-cron) ET par POST /api/cron/check.
 *
 *  1. lit les surveillances
 *  2. lit les disponibilités live ARPEJ
 *  3. calcule les alertes (transitions)
 *  4. notifie ; si TOUS les canaux échouent, on n'avance pas l'état
 *     (réessai au prochain cycle) ; sinon on enregistre l'alerte.
 *  5. persiste le nouvel état.
 */
import { fetchAllResidences } from "./arpej";
import { computeAlerts, type WatchRecord } from "./checker";
import { parisDay } from "./dates";
import { notify } from "./notifier";
import {
  applyCheckUpdates,
  listWatches,
  markNotified,
  recordAlert,
  recordDailyHistory,
} from "./repo";

export interface CheckSummary {
  checked: number;
  alerts: number;
  sent: number;
  failed: number;
  at: string;
}

export async function runCheck(): Promise<CheckSummary> {
  const at = new Date();
  const watches = await listWatches();
  if (watches.length === 0) {
    return { checked: 0, alerts: 0, sent: 0, failed: 0, at: at.toISOString() };
  }

  const residences = await fetchAllResidences();
  const { alerts, updates } = computeAlerts(watches, residences);
  const updateBySlug = new Map<string, WatchRecord>(updates.map((u) => [u.slug, u]));

  // Historique quotidien : toutes les résidences live + les surveillées absentes (0).
  const liveSlugs = new Set(residences.map((r) => r.slug));
  const points = residences.map((r) => ({ slug: r.slug, availableRooms: r.availableRooms }));
  for (const w of watches) {
    if (!liveSlugs.has(w.slug)) points.push({ slug: w.slug, availableRooms: 0 });
  }
  await recordDailyHistory(points, parisDay()).catch((e) =>
    console.error("[check] history:", e),
  );

  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const channels = await notify(alert);
    const anyOk = Object.values(channels).some(Boolean);

    await recordAlert({
      slug: alert.slug,
      title: alert.title,
      link: alert.link,
      availableRooms: alert.availableRooms,
      channels,
      createdAt: new Date(),
    });

    if (anyOk) {
      sent += 1;
      await markNotified(alert.slug, new Date());
    } else {
      // échec total : forcer un réessai au prochain cycle
      failed += 1;
      const u = updateBySlug.get(alert.slug);
      if (u) {
        u.lastAvailable = false;
        u.lastAvailableRooms = 0;
      }
    }
  }

  await applyCheckUpdates(updates);

  console.log(
    `[check] ${watches.length} surveillée(s), ${alerts.length} alerte(s), ${sent} envoyée(s), ${failed} échec(s)`,
  );

  return {
    checked: watches.length,
    alerts: alerts.length,
    sent,
    failed,
    at: at.toISOString(),
  };
}
