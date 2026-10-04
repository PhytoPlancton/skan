import { requireUser } from "@/lib/current-user";
import {
  getUser,
  normalizeChannels,
  normalizeEmail,
  normalizePhone,
  toPublic,
  updateUser,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mon compte (identifiant, rôle, coordonnées et canaux d'alerte, accueil, jeton d'agent). */
export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  return Response.json({ user: toPublic(g.user) });
}

/**
 * Modifier mes préférences d'alerte : { phone?, email?, channels?, onboarded? }.
 * Cohérence vérifiée sur l'état final : SMS/WhatsApp ⇒ téléphone, Email ⇒ email.
 */
export async function PATCH(req: Request) {
  const g = await requireUser();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateUser>[1] = {};
  if (body.phone !== undefined) {
    const p = normalizePhone(body.phone);
    if (p === null) {
      return Response.json({ error: "numéro invalide — format international, ex. +33612345678" }, { status: 400 });
    }
    patch.phone = p;
  }
  if (body.email !== undefined) {
    const e = normalizeEmail(body.email);
    if (e === null) return Response.json({ error: "email invalide" }, { status: 400 });
    patch.email = e;
  }
  if (body.channels !== undefined) {
    const c = normalizeChannels(body.channels);
    if (!c) return Response.json({ error: "choisis au moins un moyen d'alerte" }, { status: 400 });
    patch.channels = c;
  }
  if (body.onboarded === true) patch.onboardedAt = new Date();

  const pub = toPublic(g.user);
  const phone = patch.phone ?? pub.phone;
  const email = patch.email ?? pub.email;
  const channels = patch.channels ?? pub.channels;
  if ((channels.includes("sms") || channels.includes("whatsapp")) && !phone) {
    return Response.json({ error: "renseigne ton numéro pour les SMS / WhatsApp" }, { status: 400 });
  }
  if (channels.includes("email") && !email) {
    return Response.json({ error: "renseigne ton email pour les alertes par email" }, { status: 400 });
  }

  await updateUser(g.user._id, patch);
  return Response.json({ ok: true, user: toPublic((await getUser(g.user._id))!) });
}
