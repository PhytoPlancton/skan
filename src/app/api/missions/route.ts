import { listMissions } from "@/lib/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const missions = await listMissions(50);
    return Response.json({ missions });
  } catch (err) {
    console.error("[api/missions]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
