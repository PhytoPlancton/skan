/**
 * Accès données : surveillances (`watches`) et historique d'alertes (`alerts`).
 * Aucune logique réseau ici (séparation front / API / données).
 */
import { getDb } from "./db";
import type { WatchRecord } from "./checker";

const WATCHES = "watches";
const ALERTS = "alerts";

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
