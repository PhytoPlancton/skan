import { verifyPassword } from "@/lib/password";
import { createSessionValue, sessionCookieHeader, SESSION_DAYS } from "@/lib/session";
import { ensureBootstrap, getActiveUser, normalizeUserId } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rate-limit mémoire : 5 essais / 15 min, par IP ET par identifiant (force brute lente).
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX = 5;
const WINDOW = 15 * 60_000;

function blocked(key: string, now: number): boolean {
  const a = attempts.get(key);
  return !!a && a.resetAt > now && a.count >= MAX;
}

function fail(key: string, now: number): void {
  const a = attempts.get(key);
  const cur = a && a.resetAt > now ? a : { count: 0, resetAt: now + WINDOW };
  cur.count += 1;
  attempts.set(key, cur);
}

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return Response.json({ error: "Auth non configurée (AUTH_SECRET requis)" }, { status: 501 });
  }
  await ensureBootstrap();

  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* body invalide */
  }
  const password = String(body.password ?? "");
  const userId = normalizeUserId(body.username);

  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const userKey = `user:${userId ?? "?"}`;
  if (blocked(ipKey, now) || blocked(userKey, now)) {
    return Response.json({ error: "Trop d'essais — réessaie dans 15 min" }, { status: 429 });
  }

  const user = userId ? await getActiveUser(userId) : null;
  if (!user || !password || !verifyPassword(password, user.passwordHash)) {
    fail(ipKey, now);
    if (userId) fail(userKey, now);
    return Response.json({ error: "Identifiant ou mot de passe incorrect" }, { status: 401 });
  }

  attempts.delete(ipKey);
  attempts.delete(userKey);
  const value = await createSessionValue(user._id, secret);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookieHeader(value, SESSION_DAYS * 86_400),
    },
  });
}
