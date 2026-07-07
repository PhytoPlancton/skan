/**
 * Décision d'auto-candidature — logique PURE (aucune I/O), testable.
 * Entrées : settings, l'alerte (place détectée), prix, compteurs actuels.
 * Sortie : créer une mission (avec date de démarrage respectant délai aléatoire
 * + fenêtre horaire Paris) ou skip motivé (journalisé — jamais de silence).
 */
import type { AlertEvent } from "./checker";
import { parisMinutesOfDay, timeToMinutes } from "./dates";
import type { AppSettings } from "./settings";

export interface ApplyCounters {
  /** Dépôts (réels) effectués aujourd'hui / cette semaine. */
  today: number;
  week: number;
  /** Missions/dossiers encore actifs. */
  active: number;
}

export type ApplyDecision =
  | { action: "apply"; mode: "hybrid" | "auto"; notBefore: Date; dryRun: boolean }
  | { action: "skip"; reason: string };

/**
 * Calcule l'instant d'exécution : now + délai aléatoire, replié dans la
 * fenêtre horaire (raisonnement en deltas de minutes → indépendant du fuseau serveur).
 */
export function computeNotBefore(
  s: AppSettings,
  now: Date,
  rand: () => number = Math.random,
): Date {
  const delayMin = s.delayMinMin + rand() * Math.max(0, s.delayMaxMin - s.delayMinMin);
  let candidate = new Date(now.getTime() + delayMin * 60_000);

  const startMin = timeToMinutes(s.actionWindowStart);
  const endMin = timeToMinutes(s.actionWindowEnd);
  const candMin = parisMinutesOfDay(candidate);

  if (candMin < startMin || candMin > endMin) {
    // report à la prochaine ouverture de fenêtre + petit jitter (0..delayMin)
    const diff = (startMin - candMin + 1440) % 1440;
    candidate = new Date(
      candidate.getTime() + diff * 60_000 + rand() * s.delayMinMin * 60_000,
    );
  }
  return candidate;
}

export function decideApplication(
  s: AppSettings,
  alert: AlertEvent,
  priceFrom: number | null,
  counters: ApplyCounters,
  now: Date = new Date(),
  rand: () => number = Math.random,
): ApplyDecision {
  if (!s.agentEnabled) return { action: "skip", reason: "agent coupé" };
  if (s.pausedUntil && new Date(s.pausedUntil) > now) {
    return { action: "skip", reason: `en pause jusqu'au ${s.pausedUntil}` };
  }
  if (s.mode === "manual") return { action: "skip", reason: "mode manuel (alerte seule)" };

  const strat = s.strategies[alert.slug];
  if (!strat || strat.mode === "off") {
    return { action: "skip", reason: "résidence non armée (alerte seule)" };
  }
  if (strat.mode === "criteria") {
    if (typeof strat.maxRent !== "number") {
      return { action: "skip", reason: "critères sans loyer max défini" };
    }
    if (priceFrom === null) {
      return { action: "skip", reason: "prix inconnu (critères actifs)" };
    }
    if (priceFrom > strat.maxRent) {
      return {
        action: "skip",
        reason: `ignoré : ${Math.round(priceFrom)} € > ${strat.maxRent} € max`,
      };
    }
  }

  if (counters.today >= s.maxPerDay) {
    return { action: "skip", reason: `plafond jour atteint (${counters.today}/${s.maxPerDay})` };
  }
  if (counters.week >= s.maxPerWeek) {
    return {
      action: "skip",
      reason: `plafond semaine atteint (${counters.week}/${s.maxPerWeek})`,
    };
  }
  if (counters.active >= s.maxActiveApplications) {
    return {
      action: "skip",
      reason: `plafond dossiers actifs atteint (${counters.active}/${s.maxActiveApplications})`,
    };
  }

  return {
    action: "apply",
    mode: s.mode === "auto" ? "auto" : "hybrid",
    notBefore: computeNotBefore(s, now, rand),
    dryRun: s.testMode,
  };
}
