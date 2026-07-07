import { verifyPassword } from "@/lib/password";
import { createSessionValue, sessionCookieHeader } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rate-limit mémoire : 5 essais / 15 min / IP (mot de passe unique → force brute lente).
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  const hash = process.env.AUTH_PASSWORD_HASH;
  if (!secret || !hash) {
    return Response.json(
      { error: "Auth non configurée (AUTH_SECRET + AUTH_PASSWORD_HASH requis)" },
      { status: 501 },
    );
  }

  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.resetAt > now && a.count >= 5) {
    return Response.json({ error: "Trop d'essais — réessaie dans 15 min" }, { status: 429 });
  }

  let password = "";
  try {
    password = String((await req.json())?.password ?? "");
  } catch {
    /* body invalide */
  }

  if (!password || !verifyPassword(password, hash)) {
    const cur = a && a.resetAt > now ? a : { count: 0, resetAt: now + 15 * 60_000 };
    cur.count += 1;
    attempts.set(ip, cur);
    return Response.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  attempts.delete(ip);
  const value = await createSessionValue(secret);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookieHeader(value, 30 * 86_400),
    },
  });
}
