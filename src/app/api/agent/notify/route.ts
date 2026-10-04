import { requireAgent } from "@/lib/current-user";
import { notifyText } from "@/lib/notifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** L'agent prévient SON propriétaire (échec, intervention, place partie…). */
export async function POST(req: Request) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").slice(0, 600);
  const subject = String(body.subject ?? "skan").slice(0, 150);
  if (!text) return Response.json({ error: "text requis" }, { status: 400 });
  const link = body.link ? String(body.link).slice(0, 300) : undefined;
  const channels = await notifyText(g.user, text, subject, link);
  return Response.json({ ok: true, channels });
}
