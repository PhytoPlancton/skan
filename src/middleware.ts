/**
 * Protection globale de l'app par cookie de session signé (porte l'identifiant utilisateur).
 * - AUTH_SECRET absent : l'app refuse tout (sauf login/health) — impossible de
 *   savoir à qui appartiennent les données sans session.
 * - Exemptions : login, health, cron (secret dédié), test-notify (secret), /go/* (token signé),
 *   /api/agent/* (jeton d'agent personnel, vérifié par chaque route).
 * Le middleware ne fait que filtrer : chaque route re-vérifie l'utilisateur (requireUser).
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
  "/api/agent/",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (secret && (await verifySessionValue(cookie, secret))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: secret ? "authentification requise" : "AUTH_SECRET manquant" },
      { status: secret ? 401 : 503 },
    );
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
