/**
 * Orchestrateur d'un cycle de vérification (tous utilisateurs).
 * Utilisé par le poller interne (node-cron) ET par POST /api/cron/check.
 *
 *  1. lit les surveillances de tous les utilisateurs
 *  2. lit les disponibilités live ARPEJ (UNE fois pour tout le monde)
 *  3. calcule les alertes (transitions) de chaque utilisateur
 *  4. notifie l'utilisateur concerné ; si TOUS les canaux échouent, on n'avance
 *     pas son état (réessai au prochain cycle) ; sinon on enregistre l'alerte.
 *  5. persiste le nouvel état, puis auto-candidature par utilisateur.
 *  6. entretien : liens GO expirés, rappels garants.
 */
import { decideApplication } from "./apply-matching";
import { fetchAllResidences, type Residence } from "./arpej";
import { computeAlerts, type AlertEvent, type WatchRecord } from "./checker";
import { parisDay } from "./dates";
import {
  applyCounters,
  claimDueGuarantorReminders,
  createMissionIfNone,
  expireStaleGoMissions,
  hasMissionToday,
  recordSkip,
} from "./missions";
import { notify, notifyText } from "./notifier";
import {
  applyCheckUpdates,
  listAllWatches,
  markNotified,
  recordAlert,
  recordDailyHistory,
  type WatchDoc,
} from "./repo";
import { getSettings, type AppSettings } from "./settings";
import { ensureBootstrap, listUsers, type UserDoc } from "./users";

export interface CheckSummary {
  checked: number;
  alerts: number;
  sent: number;
  failed: number;
  at: string;
}

export async function runCheck(): Promise<CheckSummary> {
  const at = new Date();
  await ensureBootstrap();
  const users = new Map(
    (await listUsers()).filter((u) => !u.disabled).map((u) => [u._id, u] as const),
  );

  await housekeeping(users).catch((e) => console.error("[check] entretien:", e));

  const watches = (await listAllWatches()).filter((w) => users.has(w.userId));
  const settingsByUser = new Map<string, AppSettings>();
  for (const id of users.keys()) settingsByUser.set(id, await getSettings(id));
  const anyArmed = [...settingsByUser.values()].some(
    (s) => s.agentEnabled && Object.values(s.strategies).some((x) => x && x.mode !== "off"),
  );

  if (watches.length === 0 && !anyArmed) {
    return { checked: 0, alerts: 0, sent: 0, failed: 0, at: at.toISOString() };
  }

  const residences = await fetchAllResidences();

  // Historique quotidien (commun) : toutes les résidences live + les surveillées absentes (0).
  const liveSlugs = new Set(residences.map((r) => r.slug));
  const points = residences.map((r) => ({ slug: r.slug, availableRooms: r.availableRooms }));
  const absent = new Set(watches.filter((w) => !liveSlugs.has(w.slug)).map((w) => w.slug));
  for (const slug of absent) points.push({ slug, availableRooms: 0 });
  await recordDailyHistory(points, parisDay()).catch((e) =>
    console.error("[check] history:", e),
  );

  const byUser = new Map<string, WatchDoc[]>();
  for (const w of watches) {
    const list = byUser.get(w.userId) ?? [];
    list.push(w);
    byUser.set(w.userId, list);
  }

  let alertCount = 0;
  let sent = 0;
  let failed = 0;

  for (const [userId, userWatches] of byUser) {
    const user = users.get(userId)!;
    const r = await checkUser(user, userWatches, residences).catch((e) => {
      console.error(`[check] ${userId}:`, e);
      return { alerts: 0, sent: 0, failed: 0 };
    });
    alertCount += r.alerts;
    sent += r.sent;
    failed += r.failed;
  }

  // ── Auto-apply : toute résidence ARMÉE et disponible maintenant, par utilisateur ─────
  // (indépendant des transitions : armer une résidence déjà dispo => on postule ;
  //  l'idempotence hasMissionToday empêche les doublons/spam.)
  for (const [userId, settings] of settingsByUser) {
    await runAutoApply(users.get(userId)!, settings, residences).catch((e) =>
      console.error(`[check] auto-apply ${userId}:`, e),
    );
  }

  console.log(
    `[check] ${users.size} utilisateur(s), ${watches.length} surveillance(s), ${alertCount} alerte(s), ${sent} envoyée(s), ${failed} échec(s)`,
  );

  return {
    checked: watches.length,
    alerts: alertCount,
    sent,
    failed,
    at: at.toISOString(),
  };
}

/** Alertes d'un utilisateur : transitions sur SES surveillances, notifiées à LUI. */
async function checkUser(
  user: UserDoc,
  watches: WatchRecord[],
  residences: Residence[],
): Promise<{ alerts: number; sent: number; failed: number }> {
  const { alerts, updates } = computeAlerts(watches, residences);
  const updateBySlug = new Map<string, WatchRecord>(updates.map((u) => [u.slug, u]));
  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const channels = await notify(user, alert);
    const anyOk = Object.values(channels).some(Boolean);

    await recordAlert({
      userId: user._id,
      slug: alert.slug,
      title: alert.title,
      link: alert.link,
      availableRooms: alert.availableRooms,
      channels,
      createdAt: new Date(),
    });

    if (anyOk) {
      sent += 1;
      await markNotified(user._id, alert.slug, new Date());
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

  await applyCheckUpdates(user._id, updates);
  return { alerts: alerts.length, sent, failed };
}

/** Entretien (serveur 24/7) : liens GO expirés et rappels garants, notifiés à leur propriétaire. */
async function housekeeping(users: Map<string, UserDoc>): Promise<void> {
  for (const m of await expireStaleGoMissions()) {
    const u = users.get(m.userId);
    if (!u) continue;
    await notifyText(
      u,
      `⌛️ skan — le lien GO pour ${m.title} a expiré (24 h) sans clic. Aucune soumission. La place est peut-être encore dispo : ${m.link}`,
      `skan — GO expiré : ${m.title}`,
    );
  }
  for (const m of await claimDueGuarantorReminders()) {
    const u = users.get(m.userId);
    if (!u) continue;
    await notifyText(
      u,
      `⏰ skan — rappel : si tes garants n'ont pas encore validé le dossier ${m.title} (lien reçu par email il y a ~4 h), relance-les — le dossier reste incomplet sans eux.`,
      `skan — rappel garants : ${m.title}`,
    );
  }
}

/**
 * Parcourt les résidences ARMÉES (stratégie ≠ off) et disponibles d'un utilisateur,
 * et lance l'évaluation d'auto-candidature pour chacune (idempotent via hasMissionToday).
 */
async function runAutoApply(
  user: UserDoc,
  settings: AppSettings,
  residences: Residence[],
): Promise<void> {
  if (!settings.agentEnabled) return; // agent coupé → aucune activité d'auto-apply
  const armed = Object.entries(settings.strategies).filter(([, s]) => s && s.mode !== "off");
  if (armed.length === 0) return;

  const bySlug = new Map(residences.map((r) => [r.slug, r]));
  for (const [slug] of armed) {
    const r = bySlug.get(slug);
    if (!r || r.availableRooms <= 0) continue; // on ne postule que si dispo maintenant
    if (await hasMissionToday(user._id, slug)) continue; // déjà traité aujourd'hui → skip silencieux
    const alert: AlertEvent = {
      slug,
      title: r.title,
      link: r.link,
      availableRooms: r.availableRooms,
    };
    await evaluateAutoApply(user, settings, alert, r.priceFrom).catch((e) =>
      console.error("[check] auto-apply", user._id, slug, e),
    );
  }
}

/**
 * Évalue une candidature : crée une mission (hybride/auto), notifie « aurait
 * postulé » en mode à blanc, ou journalise le refus motivé.
 */
async function evaluateAutoApply(
  user: UserDoc,
  settings: AppSettings,
  alert: AlertEvent,
  priceFrom: number | null,
): Promise<void> {
  const counters = await applyCounters(user._id);
  const decision = decideApplication(settings, alert, priceFrom, counters);

  if (decision.action === "skip") {
    await recordSkip(user._id, alert, decision.reason);
    console.log(`[apply] ${user._id} skip ${alert.slug} — ${decision.reason}`);
    return;
  }

  if (decision.dryRun) {
    await recordSkip(user._id, alert, "mode à blanc : aurait postulé");
    await notifyText(
      user,
      `🧪 skan [À BLANC] — aurait postulé pour ${alert.title} (${alert.availableRooms} dispo, mode ${decision.mode}). Désactive le mode à blanc dans Settings pour armer réellement.`,
      `skan à blanc — ${alert.title}`,
    );
    return;
  }

  const res = await createMissionIfNone({
    userId: user._id,
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
    console.log(`[apply] ${user._id} mission non créée pour ${alert.slug} — ${res.reason}`);
    return;
  }
  console.log(
    `[apply] ${user._id} mission créée pour ${alert.slug} (mode ${decision.mode}, pas avant ${decision.notBefore.toISOString()})`,
  );
  await notifyText(
    user,
    `🤖 skan — candidature ${decision.mode === "auto" ? "automatique" : "hybride"} programmée pour ${alert.title} (${alert.availableRooms} dispo). Préparation ~${decision.notBefore.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}. Ton agent doit être allumé.`,
    `skan — candidature programmée : ${alert.title}`,
  );
}
