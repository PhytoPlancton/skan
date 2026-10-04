import { requireAdmin } from "@/lib/current-user";
import { revokeAgentToken, rotateAgentToken } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Génère un jeton d'agent pour ce compte (à transmettre à la personne). */
export async function POST(_req: Request, { params }: Ctx) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const { id } = await params;
  const token = await rotateAgentToken(id);
  if (!token) return Response.json({ error: "compte inconnu" }, { status: 404 });
  return Response.json({ ok: true, token });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const { id } = await params;
  await revokeAgentToken(id);
  return Response.json({ ok: true });
}
