/**
 * Accès données : surveillances (`watches`) et historique d'alertes (`alerts`),
 * toujours filtrées par utilisateur ; historique des dispos (`history`, commun).
 * Aucune logique réseau ici (séparation front / API / données).
 */
import { getDb } from "./db";
import type { WatchRecord } from "./checker";
import { dayMinus } from "./dates";
import type { WatchFilters } from "./typologies";

const WATCHES = "watches";
const ALERTS = "alerts";
const HISTORY = "history";

export interface WatchDoc extends WatchRecord {
  userId: string;
  createdAt: Date;
  lastNotifiedAt: Date | null;
}

export interface AlertDoc {
  userId: string;
  slug: string;
  /** Détail par type (« 1 Comfort Studio (29–38 m², 602–704 €) »). */
  detail?: string;
  title: string;
  link: string;
  availableRooms: number;
  channels: Record<string, boolean>;
  createdAt: Date;
}

/** Liste les surveillances d'un utilisateur (plus anciennes d'abord). */
export async function listWatches(userId: string): Promise<WatchDoc[]> {
  const db = await getDb();
  return db
    .collection<WatchDoc>(WATCHES)
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
}

/**
 * Ajoute / met à jour une surveillance avec une baseline (état courant).
 * La baseline est posée sans alerte : on ne notifie que sur transition ultérieure.
 */
export async function upsertWatch(userId: string, rec: WatchRecord): Promise<void> {
  const db = await getDb();
  await db.collection<WatchDoc>(WATCHES).updateOne(
    { userId, slug: rec.slug },
    {
      $setOnInsert: { userId, slug: rec.slug, createdAt: new Date(), lastNotifiedAt: null },
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

export async function getWatch(userId: string, slug: string): Promise<WatchDoc | null> {
  const db = await getDb();
  return db.collection<WatchDoc>(WATCHES).findOne({ userId, slug }, { projection: { _id: 0 } });
}

/** Change les filtres d'une surveillance et repose la baseline (sans alerte). */
export async function setWatchFilters(
  userId: string,
  slug: string,
  filters: WatchFilters | null,
  baselineAvailable: boolean,
): Promise<boolean> {
  const db = await getDb();
  const r = await db
    .collection<WatchDoc>(WATCHES)
    .updateOne({ userId, slug }, { $set: { filters, lastAvailable: baselineAvailable } });
  return r.matchedCount > 0;
}

export async function removeWatch(userId: string, slug: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.collection(WATCHES).deleteOne({ userId, slug });
  return r.deletedCount > 0;
}

/** Toutes les surveillances, tous utilisateurs confondus (boucle de vérification uniquement). */
export async function listAllWatches(): Promise<WatchDoc[]> {
  const db = await getDb();
  return db
    .collection<WatchDoc>(WATCHES)
    .find({ userId: { $exists: true } }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Persiste le nouvel état (lastAvailable / nombre de logements) de chaque surveillance. */
export async function applyCheckUpdates(userId: string, updates: WatchRecord[]): Promise<void> {
  if (updates.length === 0) return;
  const db = await getDb();
  await db.collection<WatchDoc>(WATCHES).bulkWrite(
    updates.map((u) => ({
      updateOne: {
        filter: { userId, slug: u.slug },
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

export async function markNotified(userId: string, slug: string, when: Date): Promise<void> {
  const db = await getDb();
  await db
    .collection<WatchDoc>(WATCHES)
    .updateOne({ userId, slug }, { $set: { lastNotifiedAt: when } });
}

export async function recordAlert(alert: AlertDoc): Promise<void> {
  const db = await getDb();
  await db.collection<AlertDoc>(ALERTS).insertOne(alert);
}

export async function listAlerts(userId: string, limit = 50): Promise<AlertDoc[]> {
  const db = await getDb();
  return db
    .collection<AlertDoc>(ALERTS)
    .find({ userId }, { projection: { _id: 0, userId: 0 } })
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
