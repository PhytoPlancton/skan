/**
 * Configuration de l'auto-candidature (doc singleton Mongo `settings`).
 * Les plafonds saisis sont bornés par des LIMITES ABSOLUES hardcodées
 * (jamais configurables — cf. tasks/settings-spec.md §4).
 */
import { getDb } from "./db";

// ── Limites absolues (sûreté, non configurables) ──────────────────
export const HARD_LIMITS = {
  windowEarliest: "07:00",
  windowLatest: "23:00",
  minDelayMin: 2,
  maxPerDay: 2,
  maxPerWeek: 4,
  maxActiveApplications: 4,
  /** Nb de soumissions hybrides réussies requises pour débloquer FULL-AUTO. */
  autoUnlockAfterHybridSuccesses: 2,
} as const;

export type GlobalMode = "manual" | "hybrid" | "auto";
export type ResidenceStrategy = {
  mode: "off" | "love" | "criteria";
  /** Loyer max charges comprises (€) — requis si mode = criteria. */
  maxRent?: number;
  /** Départage si plusieurs places s'ouvrent (1 = premier servi). */
  priority?: number;
};

export interface AppSettings {
  agentEnabled: boolean;
  pausedUntil: string | null; // ISO
  mode: GlobalMode;
  testMode: boolean; // « à blanc » : évalue + notifie, ne touche jamais iBail
  hybridSuccessCount: number;
  actionWindowStart: string; // "HH:MM"
  actionWindowEnd: string;
  delayMinMin: number;
  delayMaxMin: number;
  maxPerDay: number;
  maxPerWeek: number;
  maxActiveApplications: number;
  strategies: Record<string, ResidenceStrategy>;
  llmAssist: boolean;
  updatedAt?: Date;
}

export const DEFAULT_SETTINGS: AppSettings = {
  agentEnabled: false,
  pausedUntil: null,
  mode: "hybrid",
  testMode: true,
  hybridSuccessCount: 0,
  actionWindowStart: "08:30",
  actionWindowEnd: "22:00",
  delayMinMin: 4,
  delayMaxMin: 25,
  maxPerDay: 1,
  maxPerWeek: 3,
  maxActiveApplications: 2,
  strategies: {},
  llmAssist: false,
};

const COLL = "settings";
const DOC_ID = "app";

function clampTime(t: string, min: string, max: string): string {
  const ok = /^\d{2}:\d{2}$/.test(t);
  if (!ok) return min;
  return t < min ? min : t > max ? max : t;
}

/** Applique les bornes absolues à une config quelconque. */
export function clampSettings(s: AppSettings): AppSettings {
  const out = { ...s };
  out.actionWindowStart = clampTime(
    s.actionWindowStart,
    HARD_LIMITS.windowEarliest,
    HARD_LIMITS.windowLatest,
  );
  out.actionWindowEnd = clampTime(
    s.actionWindowEnd,
    out.actionWindowStart,
    HARD_LIMITS.windowLatest,
  );
  out.delayMinMin = Math.max(HARD_LIMITS.minDelayMin, Math.round(s.delayMinMin) || 0);
  out.delayMaxMin = Math.max(out.delayMinMin, Math.round(s.delayMaxMin) || 0);
  out.maxPerDay = Math.min(HARD_LIMITS.maxPerDay, Math.max(0, Math.round(s.maxPerDay) || 0));
  out.maxPerWeek = Math.min(HARD_LIMITS.maxPerWeek, Math.max(0, Math.round(s.maxPerWeek) || 0));
  out.maxActiveApplications = Math.min(
    HARD_LIMITS.maxActiveApplications,
    Math.max(0, Math.round(s.maxActiveApplications) || 0),
  );
  // FULL-AUTO verrouillé tant que le quota de succès hybrides n'est pas atteint
  if (
    out.mode === "auto" &&
    (s.hybridSuccessCount ?? 0) < HARD_LIMITS.autoUnlockAfterHybridSuccesses
  ) {
    out.mode = "hybrid";
  }
  return out;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const doc = await db.collection(COLL).findOne({ _id: DOC_ID as never });
  const merged = { ...DEFAULT_SETTINGS, ...(doc ?? {}) } as AppSettings;
  return clampSettings(merged);
}

/** Patch partiel — hybridSuccessCount n'est PAS modifiable par l'UI. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const { hybridSuccessCount: _ignored, updatedAt: _ts, ...rest } = patch as Record<
    string,
    unknown
  > as Partial<AppSettings>;
  const next = clampSettings({ ...current, ...rest, hybridSuccessCount: current.hybridSuccessCount });
  const db = await getDb();
  const { updatedAt: _u, ...toStore } = next;
  await db
    .collection(COLL)
    .updateOne(
      { _id: DOC_ID as never },
      { $set: { ...toStore, updatedAt: new Date() } },
      { upsert: true },
    );
  return next;
}

export async function incrementHybridSuccess(): Promise<void> {
  const db = await getDb();
  await db
    .collection(COLL)
    .updateOne({ _id: DOC_ID as never }, { $inc: { hybridSuccessCount: 1 } }, { upsert: true });
}
