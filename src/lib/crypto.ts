/**
 * Chiffrement du coffre : AES-256-GCM (node:crypto).
 * Clé : env VAULT_KEY, 64 caractères hex (32 octets).
 * Format stocké : base64( iv[12] | authTag[16] | ciphertext ).
 * Toute donnée confidentielle (garants, dossier, session iBail) passe par ici
 * avant d'être persistée — jamais de clair en base.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.VAULT_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("VAULT_KEY manquante ou invalide (attendu : 64 caractères hex)");
  }
  return Buffer.from(hex, "hex");
}

export function vaultConfigured(): boolean {
  const hex = process.env.VAULT_KEY;
  return !!hex && /^[0-9a-fA-F]{64}$/.test(hex);
}

export function encryptBuffer(plain: Buffer, key: Buffer = getKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptBuffer(payload: string, key: Buffer = getKey()): Buffer {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_LEN + TAG_LEN) throw new Error("payload chiffré invalide");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function encryptJson(value: unknown, key?: Buffer): string {
  return encryptBuffer(Buffer.from(JSON.stringify(value), "utf8"), key);
}

export function decryptJson<T>(payload: string, key?: Buffer): T {
  return JSON.parse(decryptBuffer(payload, key).toString("utf8")) as T;
}
