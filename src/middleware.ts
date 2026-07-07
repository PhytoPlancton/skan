/**
 * Protection globale de l'app par cookie de session signé.
 * - Auth non configurée (AUTH_SECRET/AUTH_PASSWORD_HASH absents) : tout passe
 *   (rétro-compat v0.2) — mais les routes sensibles (vault/settings) exigent
 *   elles-mêmes une auth configurée.
 * - Exemptions : login, health, cron (secret dédié), test-notify (secret), /go/* (token signé).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/health",
  "/api/cron/",
  "/api/test-notify",
  "/go/",
  "/api/go/",
];

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const hash = process.env.AUTH_PASSWORD_HASH;
  if (!secret || !hash) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionValue(cookie, secret)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentification requise" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // tout sauf assets statiques Next
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)"],
};
