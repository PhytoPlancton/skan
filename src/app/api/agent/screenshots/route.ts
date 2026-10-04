import { ObjectId } from "mongodb";
import { requireAgent } from "@/lib/current-user";
import { getUserMission } from "@/lib/missions";
import { saveScreenshot } from "@/lib/screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PNG_BYTES = 8 * 1024 * 1024;

/** Capture d'écran d'une étape : { missionId | null, step, png (base64) } — chiffrée côté serveur. */
export async function POST(req: Request) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const step = String(body.step ?? "").slice(0, 80);
  if (!step) return Response.json({ error: "step requis" }, { status: 400 });
  const png = Buffer.from(String(body.png ?? ""), "base64");
  if (png.length === 0 || png.length > MAX_PNG_BYTES) {
    return Response.json({ error: "capture absente ou trop lourde" }, { status: 400 });
  }
  let missionId: ObjectId | null = null;
  if (body.missionId) {
    const m = await getUserMission(g.user._id, String(body.missionId));
    if (!m) return Response.json({ error: "mission inconnue" }, { status: 404 });
    missionId = m._id!;
  }
  const id = await saveScreenshot(g.user._id, missionId, step, png);
  return Response.json({ ok: true, id });
}
