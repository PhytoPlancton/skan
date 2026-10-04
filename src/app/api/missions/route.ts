import { requireUser } from "@/lib/current-user";
import { listMissions } from "@/lib/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    const missions = await listMissions(g.user._id, 50);
    return Response.json({ missions });
  } catch (err) {
    console.error("[api/missions]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
