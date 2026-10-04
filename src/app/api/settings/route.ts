import { requireUser } from "@/lib/current-user";
import { getSettings, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    return Response.json({ settings: await getSettings(g.user._id) });
  } catch (err) {
    console.error("[api/settings GET]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    const body = await req.json();
    const settings = await saveSettings(g.user._id, body?.settings ?? {});
    return Response.json({ ok: true, settings });
  } catch (err) {
    console.error("[api/settings PUT]", err);
    return Response.json({ error: "Sauvegarde impossible" }, { status: 500 });
  }
}
