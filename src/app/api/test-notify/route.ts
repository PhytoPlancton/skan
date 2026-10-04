import { strictAuthorized } from "@/lib/auth";
import { requireUser } from "@/lib/current-user";
import { notify } from "@/lib/notifier";
import { getActiveUser, normalizeUserId, type UserDoc } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envoie une alerte de TEST (vérifie la config EDJ Labs + les coordonnées du compte).
 * - Connecté : envoi à SOI-MÊME.
 * - Sinon : CRON_SECRET (header x-cron-secret) + `?user=<identifiant>`.
 */
export async function POST(req: Request) {
  let user: UserDoc | null = null;
  if (strictAuthorized(req)) {
    const id = normalizeUserId(new URL(req.url).searchParams.get("user"));
    user = id ? await getActiveUser(id) : null;
    if (!user) return Response.json({ error: "?user=<identifiant> requis" }, { status: 400 });
  } else {
    const g = await requireUser();
    if (g.error) return g.error;
    user = g.user;
  }
  try {
    const channels = await notify(user, {
      slug: "test",
      title: "Test skan",
      link: new URL(req.url).origin,
      availableRooms: 1,
    });
    return Response.json({ ok: true, channels });
  } catch (err) {
    console.error("[api/test-notify]", err);
    return Response.json({ error: "échec de l'envoi de test" }, { status: 500 });
  }
}
