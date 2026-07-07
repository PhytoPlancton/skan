/**
 * Hash de mot de passe via scrypt (node:crypto, zéro dépendance).
 * Format stocké : `scrypt$<saltHex>$<hashHex>` — jamais de mot de passe en clair
 * (env var AUTH_PASSWORD_HASH générée par `npm run hash-password`).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
