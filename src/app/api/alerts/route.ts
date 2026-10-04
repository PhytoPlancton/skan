import { requireUser } from "@/lib/current-user";
import { listAlerts } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    const alerts = await listAlerts(g.user._id, 50);
    return Response.json({ alerts });
  } catch (err) {
    console.error("[api/alerts]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
