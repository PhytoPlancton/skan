/** Authentification simple par secret partagé (header x-cron-secret ou Bearer). */

/** L'auth par mot de passe de l'app est-elle configurée ? (middleware actif) */
export function authConfigured(): boolean {
  return !!process.env.AUTH_SECRET && !!process.env.AUTH_PASSWORD_HASH;
}

function provided(req: Request): string | null {
  return (
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    null
  );
}

/** Pour /api/cron/check : si aucun secret n'est configuré, on autorise (dev local). */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return provided(req) === secret;
}

/** Pour les actions sensibles (envoi réel) : exige un secret configuré ET correct. */
export function strictAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return provided(req) === secret;
}
