import { requireAdmin } from "@/lib/current-user";
import {
  deleteUserAndData,
  getUser,
  normalizeEmail,
  normalizePhone,
  toPublic,
  updateUser,
  validatePassword,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Modifier un compte : { phone?, email?, password?, disabled?, smsDailyLimit?, role? }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const { id } = await params;
  const target = await getUser(id);
  if (!target) return Response.json({ error: "compte inconnu" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateUser>[1] = {};
  if (body.phone !== undefined) {
    const p = normalizePhone(body.phone);
    if (p === null) return Response.json({ error: "téléphone invalide" }, { status: 400 });
    patch.phone = p;
  }
  if (body.email !== undefined) {
    const e = normalizeEmail(body.email);
    if (e === null) return Response.json({ error: "email invalide" }, { status: 400 });
    patch.email = e;
  }
  if (body.password !== undefined) {
    const invalid = validatePassword(body.password);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    patch.password = String(body.password);
  }
  if (body.smsDailyLimit !== undefined) {
    const n = Math.round(Number(body.smsDailyLimit));
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return Response.json({ error: "plafond SMS invalide (0 = illimité)" }, { status: 400 });
    }
    patch.smsDailyLimit = n;
  }
  // Garde-fou : on ne se retire pas soi-même l'accès admin.
  if (body.disabled !== undefined) {
    if (id === g.user._id) return Response.json({ error: "impossible de te désactiver toi-même" }, { status: 400 });
    patch.disabled = !!body.disabled;
  }
  if (body.role !== undefined) {
    if (id === g.user._id) return Response.json({ error: "impossible de changer ton propre rôle" }, { status: 400 });
    patch.role = body.role === "admin" ? "admin" : "user";
  }

  await updateUser(id, patch);
  return Response.json({ ok: true, user: toPublic((await getUser(id))!) });
}

/** Supprimer un compte ET toutes ses données. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const { id } = await params;
  if (id === g.user._id) return Response.json({ error: "impossible de te supprimer toi-même" }, { status: 400 });
  if (!(await getUser(id))) return Response.json({ error: "compte inconnu" }, { status: 404 });
  await deleteUserAndData(id);
  return Response.json({ ok: true });
}
