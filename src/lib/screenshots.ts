/**
 * Captures d'écran de l'agent (preuves de chaque étape).
 * Contiennent des données personnelles → chiffrées AES-256-GCM avant persist.
 */
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { decryptBuffer, encryptBuffer } from "./crypto";

const COLL = "screenshots";

export interface ScreenshotMeta {
  _id: ObjectId;
  missionId: ObjectId | null;
  step: string;
  createdAt: Date;
}

export async function saveScreenshot(
  missionId: ObjectId | null,
  step: string,
  png: Buffer,
): Promise<ObjectId> {
  const db = await getDb();
  const res = await db.collection(COLL).insertOne({
    missionId,
    step,
    data: encryptBuffer(png),
    createdAt: new Date(),
  });
  return res.insertedId;
}

export async function getScreenshot(id: string): Promise<Buffer | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<{ data: string }>(COLL)
    .findOne({ _id: new ObjectId(id) } as never);
  return doc ? decryptBuffer(doc.data) : null;
}

export async function listScreenshots(missionId: string): Promise<ScreenshotMeta[]> {
  if (!ObjectId.isValid(missionId)) return [];
  const db = await getDb();
  return db
    .collection<ScreenshotMeta>(COLL)
    .find({ missionId: new ObjectId(missionId) } as never, {
      projection: { data: 0 },
    })
    .sort({ createdAt: 1 })
    .toArray();
}
