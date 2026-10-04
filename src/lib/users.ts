/**
 * Comptes utilisateurs (collection `users`) + jeton d'agent + amorçage/migration.
 *
 * - `_id` = identifiant de connexion (minuscules, cf. USER_ID_RE).
 * - Mot de passe : hash scrypt (jamais de clair).
 * - Jeton d'agent : seul son SHA-256 est stocké ; la valeur n'est montrée qu'une fois.
 * - Amorçage : au premier démarrage multi-utilisateur, le compte admin est créé
 *   depuis AUTH_PASSWORD_HASH (+ NOTIFY_PHONE/EMAIL) et toutes les données
 *   existantes (mono-utilisateur) lui sont rattachées.
 */
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { decryptJson, encryptJson, userKey, vaultConfigured } from "./crypto";
import { hashPassword } from "./password";
import { USER_ID_RE } from "./session";

export type Role = "admin" | "user";
export type Channel = "sms" | "whatsapp" | "email";
export const ALL_CHANNELS: Channel[] = ["sms", "whatsapp", "email"];

export interface UserDoc {
  _id: string;
  passwordHash: string;
  role: Role;
  phone: string;
  email: string;
  agentTokenHash: string | null;
  agentTokenCreatedAt: Date | null;
  /** Plafond SMS + WhatsApp par jour (protège les crédits EDJ Labs). 0 = illimité. */
  smsDailyLimit: number;
  /** Canaux choisis par l'utilisateur (absent = tous les canaux actifs du serveur). */
  channels?: Channel[];
  /** Parcours d'accueil terminé (absent/null = à faire). */
  onboardedAt?: Date | null;
  /** Mot de passe provisoire (créé/réinitialisé par l'admin) → à changer. */
  mustChangePassword?: boolean;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Vue publique d'un compte (jamais de hash). */
export interface PublicUser {
  id: string;
  role: Role;
  phone: string;
  email: string;
  hasAgentToken: boolean;
  agentTokenCreatedAt: Date | null;
  smsDailyLimit: number;
  channels: Channel[];
  onboarded: boolean;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: Date;
}

export const USERS = "users";
export const DEFAULT_SMS_DAILY_LIMIT = 30;

/** Collections dont chaque document porte un `userId`. */
export const USER_SCOPED_COLLECTIONS = ["watches", "alerts", "missions", "screenshots"] as const;

export function toPublic(u: UserDoc): PublicUser {
  return {
    id: u._id,
    role: u.role,
    phone: u.phone ?? "",
    email: u.email ?? "",
    hasAgentToken: !!u.agentTokenHash,
    agentTokenCreatedAt: u.agentTokenCreatedAt ?? null,
    smsDailyLimit: u.smsDailyLimit ?? DEFAULT_SMS_DAILY_LIMIT,
    channels: u.channels ?? ALL_CHANNELS,
    onboarded: !!u.onboardedAt,
    // comptes créés avant ce champ : provisoire si créé par l'admin (rôle user)
    mustChangePassword: u.mustChangePassword ?? u.role !== "admin",
    disabled: !!u.disabled,
    createdAt: u.createdAt,
  };
}

export function normalizeUserId(raw: unknown): string | null {
  const id = String(raw ?? "").trim().toLowerCase();
  return USER_ID_RE.test(id) ? id : null;
}

/** Téléphone E.164 (+33…) ou vide. */
export function normalizePhone(raw: unknown): string | null {
  const p = String(raw ?? "").replace(/[\s.-]/g, "");
  if (p === "") return "";
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim();
  if (e === "") return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Liste de canaux valide et non vide, ou null. */
export function normalizeChannels(raw: unknown): Channel[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.map((c) => String(c)));
  const out = ALL_CHANNELS.filter((c) => set.has(c));
  return out.length > 0 && out.length === set.size ? out : null;
}

export function validatePassword(pw: unknown): string | null {
  const s = String(pw ?? "");
  if (s.length < 10) return "mot de passe trop court (10 caractères minimum)";
  if (s.length > 200) return "mot de passe trop long";
  return null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function ensureUserIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection(USERS).createIndex({ agentTokenHash: 1 }, { sparse: true });
  await db.collection("watches").createIndex({ userId: 1, slug: 1 }, { unique: true });
  await db.collection("alerts").createIndex({ userId: 1, createdAt: -1 });
  await db.collection("missions").createIndex({ userId: 1, status: 1 });
  await db.collection("screenshots").createIndex({ userId: 1, missionId: 1 });
  await db.collection("notify_usage").createIndex({ userId: 1, day: 1 }, { unique: true });
}

export async function getUser(id: string): Promise<UserDoc | null> {
  const db = await getDb();
  return db.collection<UserDoc>(USERS).findOne({ _id: id });
}

/** Utilisateur actif (existe et non désactivé). */
export async function getActiveUser(id: string): Promise<UserDoc | null> {
  const u = await getUser(id);
  return u && !u.disabled ? u : null;
}

export async function listUsers(): Promise<UserDoc[]> {
  const db = await getDb();
  return db.collection<UserDoc>(USERS).find({}).sort({ createdAt: 1 }).toArray();
}

export async function createUser(input: {
  id: string;
  password?: string;
  passwordHash?: string;
  role?: Role;
  phone?: string;
  email?: string;
  smsDailyLimit?: number;
  mustChangePassword?: boolean;
  onboarded?: boolean;
}): Promise<UserDoc> {
  const db = await getDb();
  const now = new Date();
  const doc: UserDoc = {
    _id: input.id,
    passwordHash: input.passwordHash ?? hashPassword(input.password ?? ""),
    role: input.role ?? "user",
    phone: input.phone ?? "",
    email: input.email ?? "",
    agentTokenHash: null,
    agentTokenCreatedAt: null,
    smsDailyLimit: input.smsDailyLimit ?? DEFAULT_SMS_DAILY_LIMIT,
    channels: ALL_CHANNELS,
    onboardedAt: input.onboarded ? now : null,
    mustChangePassword: input.mustChangePassword ?? false,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<UserDoc>(USERS).insertOne(doc);
  return doc;
}

export async function updateUser(
  id: string,
  patch: Partial<
    Pick<
      UserDoc,
      "phone" | "email" | "role" | "disabled" | "smsDailyLimit" | "channels" | "onboardedAt" | "mustChangePassword"
    >
  > & {
    password?: string;
  },
): Promise<boolean> {
  const db = await getDb();
  const { password, ...rest } = patch;
  const $set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (password !== undefined) $set.passwordHash = hashPassword(password);
  const r = await db.collection<UserDoc>(USERS).updateOne({ _id: id }, { $set });
  return r.matchedCount > 0;
}

/** Génère un nouveau jeton d'agent (l'ancien cesse de fonctionner). Valeur renvoyée une seule fois. */
export async function rotateAgentToken(id: string): Promise<string | null> {
  const token = `skan_${randomBytes(32).toString("hex")}`;
  const db = await getDb();
  const r = await db
    .collection<UserDoc>(USERS)
    .updateOne(
      { _id: id },
      { $set: { agentTokenHash: sha256(token), agentTokenCreatedAt: new Date(), updatedAt: new Date() } },
    );
  return r.matchedCount > 0 ? token : null;
}

export async function revokeAgentToken(id: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<UserDoc>(USERS)
    .updateOne({ _id: id }, { $set: { agentTokenHash: null, agentTokenCreatedAt: null } });
}

export async function findUserByAgentToken(token: string): Promise<UserDoc | null> {
  if (!/^skan_[0-9a-f]{64}$/.test(token)) return null;
  const db = await getDb();
  const u = await db.collection<UserDoc>(USERS).findOne({ agentTokenHash: sha256(token) });
  return u && !u.disabled ? u : null;
}

/** Supprime un compte ET toutes ses données (surveillances, missions, coffre…). */
export async function deleteUserAndData(id: string): Promise<void> {
  const db = await getDb();
  await Promise.all([
    ...USER_SCOPED_COLLECTIONS.map((c) => db.collection(c).deleteMany({ userId: id })),
    db.collection("vault").deleteMany({ userId: id }),
    db.collection("notify_usage").deleteMany({ userId: id }),
    db.collection("settings").deleteOne({ _id: id as never }),
  ]);
  await db.collection<UserDoc>(USERS).deleteOne({ _id: id });
}

// ── Amorçage + migration mono → multi-utilisateur ────────────────────

/**
 * Crée le compte admin depuis l'env si aucun compte n'existe, puis rattache
 * les données héritées (sans userId) au premier admin. Idempotent.
 */
export async function bootstrapAndMigrate(): Promise<void> {
  const db = await getDb();
  const users = db.collection<UserDoc>(USERS);

  if ((await users.countDocuments({})) === 0) {
    const hash = process.env.AUTH_PASSWORD_HASH?.trim();
    const id = normalizeUserId(process.env.ADMIN_USERNAME || "admin");
    if (hash && id) {
      try {
        await createUser({
          id,
          passwordHash: hash.replace(/^AUTH_PASSWORD_HASH\s*=\s*/i, "").trim(),
          role: "admin",
          phone: normalizePhone(process.env.NOTIFY_PHONE) || "",
          email: normalizeEmail(process.env.NOTIFY_EMAIL) || "",
          smsDailyLimit: 0,
          onboarded: true,
        });
        console.log(`[bootstrap] compte admin « ${id} » créé depuis AUTH_PASSWORD_HASH`);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e; // course : déjà créé
      }
    } else {
      console.warn(
        "[bootstrap] aucun compte : définis AUTH_PASSWORD_HASH (et ADMIN_USERNAME) ou lance `npm run create-user`",
      );
      return;
    }
  }

  const admin = await users.find({ role: "admin" }).sort({ createdAt: 1 }).limit(1).next();
  if (!admin) return;
  const owner = admin._id;

  // Comptes admin d'avant le parcours d'accueil : déjà configurés, on ne le leur impose pas.
  await users.updateMany(
    { role: "admin", onboardedAt: { $exists: false } },
    { $set: { onboardedAt: new Date(), mustChangePassword: false } },
  );

  // 1) Collections à documents : on pose userId sur tout ce qui n'en a pas.
  for (const c of USER_SCOPED_COLLECTIONS) {
    const r = await db
      .collection(c)
      .updateMany({ userId: { $exists: false } }, { $set: { userId: owner } });
    if (r.modifiedCount > 0) console.log(`[migration] ${c}: ${r.modifiedCount} doc(s) → ${owner}`);
  }

  // 2) Réglages : doc singleton « app » → doc de l'admin.
  const settings = db.collection<{ _id: string }>("settings");
  const legacySettings = await settings.findOne({ _id: "app" });
  if (legacySettings) {
    const { _id: _old, ...rest } = legacySettings;
    await settings.updateOne({ _id: owner }, { $setOnInsert: rest }, { upsert: true });
    await settings.deleteOne({ _id: "app" });
    console.log(`[migration] settings « app » → ${owner}`);
  }

  // 3) Coffre : sections chiffrées avec la clé maître → re-chiffrées avec la clé de l'admin.
  if (vaultConfigured()) {
    const vault = db.collection<{ _id: string; data: string; userId?: string; updatedAt?: Date }>(
      "vault",
    );
    const legacy = await vault.find({ userId: { $exists: false } }).toArray();
    for (const doc of legacy) {
      try {
        const value = decryptJson<unknown>(doc.data);
        await vault.updateOne(
          { _id: `${owner}:${doc._id}` },
          {
            $setOnInsert: {
              userId: owner,
              section: doc._id,
              data: encryptJson(value, userKey(owner)),
              updatedAt: doc.updatedAt ?? new Date(),
            },
          },
          { upsert: true },
        );
        await vault.deleteOne({ _id: doc._id });
        console.log(`[migration] coffre « ${doc._id} » → ${owner}`);
      } catch (e) {
        console.error(`[migration] coffre « ${doc._id} » illisible, laissé tel quel:`, e);
      }
    }
  }
}

const globalForBoot = globalThis as unknown as { _skanBoot?: Promise<void> };

/** Amorçage mémoïsé (une fois par process) ; réessaie au prochain appel en cas d'échec. */
export function ensureBootstrap(): Promise<void> {
  if (!globalForBoot._skanBoot) {
    globalForBoot._skanBoot = (async () => {
      await ensureUserIndexes();
      await bootstrapAndMigrate();
    })().catch((e) => {
      globalForBoot._skanBoot = undefined;
      throw e;
    });
  }
  return globalForBoot._skanBoot;
}
