import { listAlerts } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const alerts = await listAlerts(50);
    return Response.json({ alerts });
  } catch (err) {
    console.error("[api/alerts]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
