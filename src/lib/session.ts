/**
 * Session par cookie signé HMAC-SHA256 (Web Crypto : fonctionne en Edge
 * middleware ET en runtime Node). Valeur : `<userId>.<expEpochSec>.<hmacHex>`.
 * Seule donnée en session : l'identifiant de l'utilisateur, signé avec l'expiration.
 */

export const SESSION_COOKIE = "skan_session";
export const SESSION_DAYS = 30;

/** Identifiant utilisateur : minuscules, chiffres, `-` ou `_` (pas de point → parsing sûr). */
export const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionValue(userId: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await hmacHex(payload, secret)}`;
}

/** Renvoie l'identifiant de l'utilisateur si le cookie est valide et non expiré, sinon null. */
export async function verifySessionValue(
  value: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!USER_ID_RE.test(userId)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const expected = await hmacHex(`${userId}.${expStr}`, secret);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export function sessionCookieHeader(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
