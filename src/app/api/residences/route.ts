import { requireUser } from "@/lib/current-user";
import { getDashboard } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    const dashboard = await getDashboard(g.user._id, g.user.minSurface ?? null);
    return Response.json(dashboard);
  } catch (err) {
    console.error("[api/residences]", err);
    return Response.json(
      { error: "Impossible de récupérer les résidences" },
      { status: 502 },
    );
  }
}
