/**
 * Accès données : surveillances (`watches`) et historique d'alertes (`alerts`).
 * Aucune logique réseau ici (séparation front / API / données).
 */
import { getDb } from "./db";
import type { WatchRecord } from "./checker";
import { dayMinus } from "./dates";

const WATCHES = "watches";
const ALERTS = "alerts";
const HISTORY = "history";

export interface WatchDoc extends WatchRecord {
  createdAt: Date;
  lastNotifiedAt: Date | null;
}

export interface AlertDoc {
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  channels: Record<string, boolean>;
  createdAt: Date;
}

/** Liste les surveillances (plus anciennes d'abord). */
export async function listWatches(): Promise<WatchDoc[]> {
  const db = await getDb();
  return db
    .collection<WatchDoc>(WATCHES)
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
}

/**
 * Ajoute / met à jour une surveillance avec une baseline (état courant).
 * La baseline est posée sans alerte : on ne notifie que sur transition ultérieure.
 */
export async function upsertWatch(rec: WatchRecord): Promise<void> {
  const db = await getDb();
  await db.collection<WatchDoc>(WATCHES).updateOne(
    { slug: rec.slug },
    {
      $setOnInsert: { slug: rec.slug, createdAt: new Date(), lastNotifiedAt: null },
      $set: {
        title: rec.title,
        link: rec.link,
        lastAvailable: rec.lastAvailable,
        lastAvailableRooms: rec.lastAvailableRooms,
      },
    },
    { upsert: true },
  );
}

export async function removeWatch(slug: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection(WATCHES).deleteOne({ slug });
  return r.deletedCount > 0;
}

/** Persiste le nouvel état (lastAvailable / nombre de logements) de chaque surveillance. */
export async function applyCheckUpdates(updates: WatchRecord[]): Promise<void> {
  if (updates.length === 0) return;
  const db = await getDb();
  await db.collection<WatchDoc>(WATCHES).bulkWrite(
    updates.map((u) => ({
      updateOne: {
        filter: { slug: u.slug },
        update: {
          $set: {
            title: u.title,
            link: u.link,
            lastAvailable: u.lastAvailable,
            lastAvailableRooms: u.lastAvailableRooms,
          },
        },
      },
    })),
  );
}

export async function markNotified(slug: string, when: Date): Promise<void> {
  const db = await getDb();
  await db
    .collection<WatchDoc>(WATCHES)
    .updateOne({ slug }, { $set: { lastNotifiedAt: when } });
}

export async function recordAlert(alert: AlertDoc): Promise<void> {
  const db = await getDb();
  await db.collection<AlertDoc>(ALERTS).insertOne(alert);
}

export async function listAlerts(limit = 50): Promise<AlertDoc[]> {
  const db = await getDb();
  return db
    .collection<AlertDoc>(ALERTS)
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

// ── Historique quotidien (série temporelle des dispos) ────────────────

export interface HistoryPoint {
  slug: string;
  day: string; // YYYY-MM-DD (Europe/Paris)
  availableRooms: number; // pic de la journée
}

export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection(HISTORY).createIndex({ slug: 1, day: 1 }, { unique: true });
}

/** Upsert du point du jour pour chaque résidence (garde le pic via $max). */
export async function recordDailyHistory(
  points: { slug: string; availableRooms: number }[],
  day: string,
): Promise<void> {
  if (points.length === 0) return;
  const db = await getDb();
  await db.collection(HISTORY).bulkWrite(
    points.map((p) => ({
      updateOne: {
        filter: { slug: p.slug, day },
        update: { $max: { availableRooms: p.availableRooms } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** Série des `days` derniers jours pour une résidence (jour croissant). */
export async function getHistory(slug: string, days: number): Promise<HistoryPoint[]> {
  const db = await getDb();
  const since = dayMinus(days - 1);
  return db
    .collection<HistoryPoint>(HISTORY)
    .find({ slug, day: { $gte: since } }, { projection: { _id: 0 } })
    .sort({ day: 1 })
    .toArray();
}
