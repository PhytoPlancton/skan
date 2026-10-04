import { requireAgent } from "@/lib/current-user";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** L'agent vérifie son jeton et l'état de son interrupteur (agent actif / pause). */
export async function GET(req: Request) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const s = await getSettings(g.user._id);
  return Response.json({
    user: g.user._id,
    agentEnabled: s.agentEnabled,
    pausedUntil: s.pausedUntil,
  });
}
