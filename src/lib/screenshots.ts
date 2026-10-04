/**
 * Captures d'écran de l'agent (preuves de chaque étape).
 * Contiennent des données personnelles → chiffrées AES-256-GCM avant persist.
 */
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { decryptBuffer, encryptBuffer, userKey } from "./crypto";

const COLL = "screenshots";

export interface ScreenshotMeta {
  _id: ObjectId;
  userId: string;
  missionId: ObjectId | null;
  step: string;
  createdAt: Date;
}

export async function saveScreenshot(
  userId: string,
  missionId: ObjectId | null,
  step: string,
  png: Buffer,
): Promise<ObjectId> {
  const db = await getDb();
  const res = await db.collection(COLL).insertOne({
    userId,
    missionId,
    step,
    // enc « user » : chiffré avec la clé de l'utilisateur (les anciennes captures : clé maître)
    enc: "user",
    data: encryptBuffer(png, userKey(userId)),
    createdAt: new Date(),
  });
  return res.insertedId;
}

export async function getScreenshot(userId: string, id: string): Promise<Buffer | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<{ data: string; enc?: string }>(COLL)
    .findOne({ _id: new ObjectId(id), userId } as never);
  if (!doc) return null;
  return doc.enc === "user" ? decryptBuffer(doc.data, userKey(userId)) : decryptBuffer(doc.data);
}

export async function listScreenshots(userId: string, missionId: string): Promise<ScreenshotMeta[]> {
  if (!ObjectId.isValid(missionId)) return [];
  const db = await getDb();
  return db
    .collection<ScreenshotMeta>(COLL)
    .find({ userId, missionId: new ObjectId(missionId) } as never, {
      projection: { data: 0 },
    })
    .sort({ createdAt: 1 })
    .toArray();
}
