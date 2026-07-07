import { authConfigured } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(): Response | null {
  if (!authConfigured()) {
    return Response.json(
      { error: "Configure AUTH_SECRET + AUTH_PASSWORD_HASH avant d'utiliser les settings" },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    return Response.json({ settings: await getSettings() });
  } catch (err) {
    console.error("[api/settings GET]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const settings = await saveSettings(body?.settings ?? {});
    return Response.json({ ok: true, settings });
  } catch (err) {
    console.error("[api/settings PUT]", err);
    return Response.json({ error: "Sauvegarde impossible" }, { status: 500 });
  }
}
