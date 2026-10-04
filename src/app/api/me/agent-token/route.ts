import { requireUser } from "@/lib/current-user";
import { revokeAgentToken, rotateAgentToken } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Génère (ou régénère) MON jeton d'agent — affiché une seule fois. */
export async function POST() {
  const g = await requireUser();
  if (g.error) return g.error;
  const token = await rotateAgentToken(g.user._id);
  return Response.json({ ok: true, token });
}

/** Révoque mon jeton (l'agent ne peut plus rien faire). */
export async function DELETE() {
  const g = await requireUser();
  if (g.error) return g.error;
  await revokeAgentToken(g.user._id);
  return Response.json({ ok: true });
}
