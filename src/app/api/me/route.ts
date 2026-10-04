import { requireUser } from "@/lib/current-user";
import { normalizeEmail, normalizePhone, toPublic, updateUser } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mon compte (identifiant, rôle, coordonnées d'alerte, état du jeton d'agent). */
export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  return Response.json({ user: toPublic(g.user) });
}

/** Modifier mes coordonnées d'alerte (téléphone E.164, email). */
export async function PATCH(req: Request) {
  const g = await requireUser();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const patch: { phone?: string; email?: string } = {};
  if (body.phone !== undefined) {
    const p = normalizePhone(body.phone);
    if (p === null) return Response.json({ error: "téléphone invalide (format +33…)" }, { status: 400 });
    patch.phone = p;
  }
  if (body.email !== undefined) {
    const e = normalizeEmail(body.email);
    if (e === null) return Response.json({ error: "email invalide" }, { status: 400 });
    patch.email = e;
  }
  await updateUser(g.user._id, patch);
  return Response.json({ ok: true, user: { ...toPublic(g.user), ...patch } });
}
