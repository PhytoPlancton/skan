/**
 * Queue de missions d'auto-candidature (collection `missions`).
 * Une mission = « déposer un dossier pour cette résidence » ; créée par le
 * checker (transition détectée + stratégie armée), consommée par l'agent.
 * TOUTE décision (y compris les refus) est journalisée — pas de silence.
 */
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { parisDay } from "./dates";

export type MissionStatus =
  | "pending" // à traiter par l'agent (dès notBefore)
  | "preparing" // agent en train de remplir le dossier
  | "awaiting_go" // hybride : dossier prêt, attend le clic GO
  | "approved" // GO cliqué → à soumettre
  | "submitting"
  | "submitted"
  | "skipped" // refus motivé (plafond, critères, à blanc…)
  | "failed"
  | "intervention" // captcha / DOM inattendu / session morte → humain requis
  | "expired"; // GO jamais cliqué

export const ACTIVE_STATUSES: MissionStatus[] = [
  "pending",
  "preparing",
  "awaiting_go",
  "approved",
  "submitting",
];

export interface MissionDoc {
  _id?: ObjectId;
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  status: MissionStatus;
  mode: "hybrid" | "auto";
  dryRun: boolean;
  reason?: string;
  notBefore: Date;
  dayKey: string;
  goToken?: string;
  goTokenExp?: Date;
  submittedAt?: Date;
  ibailRecordId?: string;
  journal: Array<{ at: Date; event: string; detail?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const COLL = "missions";

export async function ensureMissionIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection(COLL).createIndex({ slug: 1, status: 1 });
  await db.collection(COLL).createIndex({ createdAt: -1 });
}

/** Compteurs pour les plafonds (jour/semaine Paris, missions actives). */
export async function applyCounters(): Promise<{
  today: number;
  week: number;
  active: number;
}> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3_600_000);
  const weekAgo = new Date(now - 7 * 24 * 3_600_000);
  const [today, week, active] = await Promise.all([
    coll.countDocuments({ status: "submitted", submittedAt: { $gte: dayAgo } }),
    coll.countDocuments({ status: "submitted", submittedAt: { $gte: weekAgo } }),
    coll.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
  ]);
  return { today, week, active };
}

/** Crée une mission si aucune n'est active (ou déjà créée aujourd'hui) pour ce slug. */
export async function createMissionIfNone(
  m: Omit<MissionDoc, "_id" | "createdAt" | "updatedAt" | "journal" | "dayKey">,
): Promise<{ created: boolean; reason?: string }> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const dayKey = parisDay();

  const existing = await coll.findOne({
    slug: m.slug,
    $or: [{ status: { $in: ACTIVE_STATUSES } }, { dayKey, status: { $ne: "skipped" } }],
  });
  if (existing) {
    return { created: false, reason: `mission déjà ${existing.status} (#${existing._id})` };
  }

  const now = new Date();
  await coll.insertOne({
    ...m,
    dayKey,
    journal: [{ at: now, event: "created", detail: m.reason }],
    createdAt: now,
    updatedAt: now,
  } as MissionDoc);
  return { created: true };
}

/** Trace une décision de NON-action (journal des refus, visible dans l'UI). */
export async function recordSkip(
  alert: { slug: string; title: string; link: string; availableRooms: number },
  reason: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db.collection<MissionDoc>(COLL).insertOne({
    slug: alert.slug,
    title: alert.title,
    link: alert.link,
    availableRooms: alert.availableRooms,
    status: "skipped",
    mode: "hybrid",
    dryRun: false,
    reason,
    notBefore: now,
    dayKey: parisDay(),
    journal: [{ at: now, event: "skipped", detail: reason }],
    createdAt: now,
    updatedAt: now,
  } as MissionDoc);
}

export async function listMissions(limit = 50): Promise<MissionDoc[]> {
  const db = await getDb();
  return db
    .collection<MissionDoc>(COLL)
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
