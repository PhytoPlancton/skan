/**
 * Session par cookie signé HMAC-SHA256 (Web Crypto : fonctionne en Edge
 * middleware ET en runtime Node). Valeur : `<expEpochSec>.<hmacHex>`.
 * Aucune donnée en session — juste une expiration signée.
 */

export const SESSION_COOKIE = "skan_session";
const SESSION_DAYS = 30;

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

export async function createSessionValue(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  return `${exp}.${await hmacHex(String(exp), secret)}`;
}

export async function verifySessionValue(
  value: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expStr = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await hmacHex(expStr, secret);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function sessionCookieHeader(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
