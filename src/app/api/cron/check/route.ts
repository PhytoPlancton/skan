import { cronAuthorized } from "@/lib/auth";
import { runCheck } from "@/lib/check-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "non autorisé" }, { status: 401 });
  }
  try {
    const summary = await runCheck();
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[api/cron/check]", err);
    return Response.json({ error: "échec du check" }, { status: 500 });
  }
}
