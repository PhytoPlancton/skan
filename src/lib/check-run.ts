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
import { decideApplication } from "./apply-matching";
import { fetchAllResidences } from "./arpej";
import { computeAlerts, type AlertEvent, type WatchRecord } from "./checker";
import { parisDay } from "./dates";
import { applyCounters, createMissionIfNone, recordSkip } from "./missions";
import { notify, notifyText } from "./notifier";
import {
  applyCheckUpdates,
  listWatches,
  markNotified,
  recordAlert,
  recordDailyHistory,
} from "./repo";
import { getSettings } from "./settings";

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

  // ── Auto-apply : évaluer chaque alerte contre la config ─────────────
  const priceBySlug = new Map(residences.map((r) => [r.slug, r.priceFrom]));
  for (const alert of alerts) {
    await evaluateAutoApply(alert, priceBySlug.get(alert.slug) ?? null).catch((e) =>
      console.error("[check] auto-apply:", e),
    );
  }

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

/**
 * Évalue une alerte pour l'auto-candidature : crée une mission (hybride/auto),
 * notifie « aurait postulé » en mode à blanc, ou journalise le refus motivé.
 */
async function evaluateAutoApply(alert: AlertEvent, priceFrom: number | null): Promise<void> {
  const settings = await getSettings();
  // Micro-optimisation : ne rien journaliser tant que l'agent n'a jamais été activé.
  if (!settings.agentEnabled && Object.keys(settings.strategies).length === 0) return;

  const counters = await applyCounters();
  const decision = decideApplication(settings, alert, priceFrom, counters);

  if (decision.action === "skip") {
    await recordSkip(alert, decision.reason);
    console.log(`[apply] skip ${alert.slug} — ${decision.reason}`);
    return;
  }

  if (decision.dryRun) {
    await recordSkip(alert, "mode à blanc : aurait postulé");
    await notifyText(
      `🧪 skan [À BLANC] — aurait postulé pour ${alert.title} (${alert.availableRooms} dispo, mode ${decision.mode}). Désactive le mode à blanc dans Settings pour armer réellement.`,
      `skan à blanc — ${alert.title}`,
    );
    return;
  }

  const res = await createMissionIfNone({
    slug: alert.slug,
    title: alert.title,
    link: alert.link,
    availableRooms: alert.availableRooms,
    status: "pending",
    mode: decision.mode,
    dryRun: false,
    notBefore: decision.notBefore,
  });
  if (!res.created) {
    console.log(`[apply] mission non créée pour ${alert.slug} — ${res.reason}`);
    return;
  }
  console.log(
    `[apply] mission créée pour ${alert.slug} (mode ${decision.mode}, pas avant ${decision.notBefore.toISOString()})`,
  );
  await notifyText(
    `🤖 skan — candidature ${decision.mode === "auto" ? "automatique" : "hybride"} programmée pour ${alert.title} (${alert.availableRooms} dispo). Préparation ~${decision.notBefore.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}.`,
    `skan — candidature programmée : ${alert.title}`,
  );
}
