import { AGENT_SETTABLE, markReady, markSubmitted, publicUrl } from "@/lib/agent-actions";
import { requireAgent } from "@/lib/current-user";
import { getUserMission, updateMission, type MissionStatus } from "@/lib/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) =>
  v === undefined || v === null ? undefined : String(v).slice(0, max);

/**
 * Mise à jour d'une mission par son agent. Actions :
 *  - { action: "event", event, detail?, ibailRecordId? } → journal (+ id du dossier iBail)
 *  - { action: "status", status, reason?, event?, detail? } → statut terminal / soumission
 *  - { action: "ready" }                → hybride : lien GO + notification (côté serveur)
 *  - { action: "submitted", how }       → soumis : rappel garants, compteurs, notification
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const { id } = await params;
  const m = await getUserMission(g.user._id, id);
  if (!m) return Response.json({ error: "mission inconnue" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "event": {
      const patch: { ibailRecordId?: string } = {};
      const rec = str(body.ibailRecordId, 40);
      if (rec !== undefined) {
        if (!/^\d+$/.test(rec)) return Response.json({ error: "ibailRecordId invalide" }, { status: 400 });
        patch.ibailRecordId = rec;
      }
      await updateMission(g.user._id, m._id!, patch, str(body.event, 80) ?? "event", str(body.detail, 500));
      return Response.json({ ok: true });
    }
    case "status": {
      const status = String(body.status) as MissionStatus;
      if (!AGENT_SETTABLE.includes(status)) {
        return Response.json({ error: "statut non autorisé" }, { status: 400 });
      }
      await updateMission(
        g.user._id,
        m._id!,
        { status, ...(body.reason !== undefined ? { reason: str(body.reason, 500) } : {}) },
        str(body.event, 80) ?? status,
        str(body.detail, 500),
      );
      return Response.json({ ok: true });
    }
    case "ready":
      if (m.status !== "preparing") {
        return Response.json({ error: `statut ${m.status} : GO impossible` }, { status: 409 });
      }
      await markReady(g.user, m, publicUrl(req));
      return Response.json({ ok: true });
    case "submitted":
      if (m.status !== "submitting") {
        return Response.json({ error: `statut ${m.status} : soumission non attendue` }, { status: 409 });
      }
      await markSubmitted(g.user, m, str(body.how, 60) ?? "agent");
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "action inconnue" }, { status: 400 });
  }
}
