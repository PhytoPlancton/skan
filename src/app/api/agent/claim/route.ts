import { requireAgent } from "@/lib/current-user";
import { claimNextMission } from "@/lib/missions";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Réclame la prochaine mission DE CET UTILISATEUR (atomique), ou null. */
export async function POST(req: Request) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const s = await getSettings(g.user._id);
  if (!s.agentEnabled) return Response.json({ mission: null, reason: "agent coupé" });
  if (s.pausedUntil && new Date(s.pausedUntil) > new Date()) {
    return Response.json({ mission: null, reason: "en pause" });
  }
  const m = await claimNextMission(g.user._id);
  if (!m) return Response.json({ mission: null });
  const { goToken: _t, journal: _j, ...mission } = m;
  return Response.json({ mission });
}
