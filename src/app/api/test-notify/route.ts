import { strictAuthorized } from "@/lib/auth";
import { notify } from "@/lib/notifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envoie une alerte de TEST sur les canaux actifs (vérifie la config EDJ Labs).
 * Protégé : exige CRON_SECRET (header x-cron-secret) car l'envoi est réel.
 */
export async function POST(req: Request) {
  if (!strictAuthorized(req)) {
    return Response.json({ error: "non autorisé (CRON_SECRET requis)" }, { status: 401 });
  }
  try {
    const channels = await notify({
      slug: "test",
      title: "Test skan",
      link: "https://skan.nmt.ovh",
      availableRooms: 1,
    });
    return Response.json({ ok: true, channels });
  } catch (err) {
    console.error("[api/test-notify]", err);
    return Response.json({ error: "échec de l'envoi de test" }, { status: 500 });
  }
}
