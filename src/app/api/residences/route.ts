import { getDashboard } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dashboard = await getDashboard();
    return Response.json(dashboard);
  } catch (err) {
    console.error("[api/residences]", err);
    return Response.json(
      { error: "Impossible de récupérer les résidences" },
      { status: 502 },
    );
  }
}
