/**
 * Hash de mot de passe via scrypt (node:crypto, zéro dépendance).
 * Format stocké : `scrypt:<saltHex>:<hashHex>` — séparateur `:` (et non `$`)
 * car certains gestionnaires d'env (EDJ Labs) interprètent `$` comme une variable.
 * Jamais de mot de passe en clair (env AUTH_PASSWORD_HASH via `npm run hash-password`).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  // Tolérant : trim, préfixe « AUTH_PASSWORD_HASH= » collé par erreur, séparateur `:` ou `$`.
  const s = (stored ?? "").trim().replace(/^AUTH_PASSWORD_HASH\s*=\s*/i, "").trim();
  const parts = s.split(/[:$]/);
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) return false;
  try {
    const expected = Buffer.from(parts[2], "hex");
    if (expected.length === 0) return false;
    const actual = scryptSync(password, Buffer.from(parts[1], "hex"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
