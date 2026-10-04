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
  userId: string;
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
  remindGuarantorsAt?: Date;
  guarantorsReminded?: boolean;
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

/** Compteurs d'un utilisateur pour ses plafonds (jour/semaine glissants, missions actives). */
export async function applyCounters(userId: string): Promise<{
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
    coll.countDocuments({ userId, status: "submitted", submittedAt: { $gte: dayAgo } }),
    coll.countDocuments({ userId, status: "submitted", submittedAt: { $gte: weekAgo } }),
    coll.countDocuments({ userId, status: { $in: ACTIVE_STATUSES } }),
  ]);
  return { today, week, active };
}

/** Crée une mission si l'utilisateur n'en a aucune active (ou déjà créée aujourd'hui) pour ce slug. */
export async function createMissionIfNone(
  m: Omit<MissionDoc, "_id" | "createdAt" | "updatedAt" | "journal" | "dayKey">,
): Promise<{ created: boolean; reason?: string }> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const dayKey = parisDay();

  const existing = await coll.findOne({
    userId: m.userId,
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
  userId: string,
  alert: { slug: string; title: string; link: string; availableRooms: number },
  reason: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db.collection<MissionDoc>(COLL).insertOne({
    userId,
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

/** Une mission existe-t-elle déjà pour ce slug (active OU créée aujourd'hui) ? (idempotence) */
export async function hasMissionToday(userId: string, slug: string): Promise<boolean> {
  const db = await getDb();
  const n = await db.collection<MissionDoc>(COLL).countDocuments({
    userId,
    slug,
    $or: [{ status: { $in: ACTIVE_STATUSES } }, { dayKey: parisDay() }],
  });
  return n > 0;
}

export async function listMissions(userId: string, limit = 50): Promise<MissionDoc[]> {
  const db = await getDb();
  return db
    .collection<MissionDoc>(COLL)
    .find({ userId }, { projection: { goToken: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

// ── Opérations côté agent ──────────────────────────────────────────

/**
 * Réclame la prochaine mission à traiter (atomique) :
 * une `approved` (GO cliqué — priorité, l'utilisateur attend) sinon une
 * `pending` arrivée à maturité (notBefore <= now). Une seule à la fois.
 */
export async function claimNextMission(userId: string): Promise<MissionDoc | null> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const now = new Date();

  const approved = await coll.findOneAndUpdate(
    { userId, status: "approved" },
    {
      $set: { status: "submitting", updatedAt: now },
      $push: { journal: { at: now, event: "claimed_for_submission" } },
    },
    { sort: { updatedAt: 1 }, returnDocument: "after" },
  );
  if (approved) return approved;

  return coll.findOneAndUpdate(
    { userId, status: "pending", notBefore: { $lte: now } },
    {
      $set: { status: "preparing", updatedAt: now },
      $push: { journal: { at: now, event: "claimed_for_preparation" } },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

export async function updateMission(
  userId: string,
  id: ObjectId,
  patch: Partial<MissionDoc>,
  journalEvent?: string,
  journalDetail?: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const update: Record<string, unknown> = { $set: { ...patch, updatedAt: now } };
  if (journalEvent) {
    update.$push = { journal: { at: now, event: journalEvent, detail: journalDetail } };
  }
  await db.collection<MissionDoc>(COLL).updateOne({ _id: id, userId }, update as never);
}

/** Mission d'un utilisateur par id (null si elle ne lui appartient pas). */
export async function getUserMission(userId: string, id: string): Promise<MissionDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<MissionDoc>(COLL).findOne({ _id: new ObjectId(id), userId });
}

/** Missions hybrides dont le lien GO a expiré → `expired` (tous utilisateurs, renvoyées pour notif). */
export async function expireStaleGoMissions(): Promise<MissionDoc[]> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const stale = await coll
    .find({ status: "awaiting_go", goTokenExp: { $lt: new Date() } })
    .toArray();
  for (const m of stale) {
    await updateMission(m.userId, m._id!, { status: "expired" }, "go_expired");
  }
  return stale;
}

export async function getMissionByToken(token: string): Promise<MissionDoc | null> {
  if (!token || token.length < 16) return null;
  const db = await getDb();
  return db.collection<MissionDoc>(COLL).findOne({ goToken: token });
}

/** Clic GO : awaiting_go + token valide + non expiré → approved (atomique). */
export async function approveMissionByToken(
  token: string,
): Promise<{ ok: boolean; reason?: string; mission?: MissionDoc }> {
  if (!token || token.length < 16) return { ok: false, reason: "token invalide" };
  const db = await getDb();
  const now = new Date();
  const mission = await db.collection<MissionDoc>(COLL).findOneAndUpdate(
    { goToken: token, status: "awaiting_go", goTokenExp: { $gte: now } },
    {
      $set: { status: "approved", updatedAt: now },
      $push: { journal: { at: now, event: "go_clicked" } },
    },
    { returnDocument: "after" },
  );
  if (mission) return { ok: true, mission };

  const existing = await db.collection<MissionDoc>(COLL).findOne({ goToken: token });
  if (!existing) return { ok: false, reason: "lien inconnu" };
  if (existing.status === "approved" || existing.status === "submitting") {
    return { ok: true, mission: existing }; // double clic → idempotent
  }
  if (existing.status === "submitted") return { ok: false, reason: "déjà soumis" };
  if (existing.goTokenExp && existing.goTokenExp < now) {
    return { ok: false, reason: "lien expiré" };
  }
  return { ok: false, reason: `statut ${existing.status}` };
}

/** Soumissions dont le rappel « préviens tes garants » est dû (tous utilisateurs). Marquées atomiquement. */
export async function claimDueGuarantorReminders(): Promise<MissionDoc[]> {
  const db = await getDb();
  const coll = db.collection<MissionDoc>(COLL);
  const due: MissionDoc[] = [];
  for (;;) {
    const m = await coll.findOneAndUpdate(
      {
        status: "submitted",
        remindGuarantorsAt: { $lte: new Date() },
        guarantorsReminded: { $ne: true },
      },
      { $set: { guarantorsReminded: true } },
      { returnDocument: "after" },
    );
    if (!m) break;
    due.push(m);
  }
  return due;
}
