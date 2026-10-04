/**
 * Résolution de l'utilisateur courant dans les route handlers (runtime Node).
 * Toute route qui lit/écrit des données personnelles DOIT passer par ici :
 * l'identité vient uniquement du cookie signé (ou du jeton d'agent), jamais du client.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "./session";
import { ensureBootstrap, findUserByAgentToken, getActiveUser, type UserDoc } from "./users";

export type Guarded = { user: UserDoc; error?: never } | { user?: never; error: Response };

function deny(status: number, error: string): { error: Response } {
  return { error: Response.json({ error }, { status }) };
}

/** Utilisateur connecté via le cookie de session, ou réponse 401/503. */
export async function requireUser(): Promise<Guarded> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return deny(503, "AUTH_SECRET manquant : l'authentification n'est pas configurée");
  await ensureBootstrap();
  const jar = await cookies();
  const userId = await verifySessionValue(jar.get(SESSION_COOKIE)?.value, secret);
  if (!userId) return deny(401, "authentification requise");
  const user = await getActiveUser(userId);
  if (!user) return deny(401, "compte inconnu ou désactivé");
  return { user };
}

export async function requireAdmin(): Promise<Guarded> {
  const g = await requireUser();
  if (g.error) return g;
  if (g.user.role !== "admin") return deny(403, "réservé à l'administrateur");
  return g;
}

/** Agent : `Authorization: Bearer skan_…` (jeton personnel, généré dans Settings). */
export async function requireAgent(req: Request): Promise<Guarded> {
  await ensureBootstrap();
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const user = token ? await findUserByAgentToken(token) : null;
  if (!user) return deny(401, "jeton d'agent invalide ou révoqué");
  return { user };
}
