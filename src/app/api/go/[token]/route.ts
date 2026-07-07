import { approveMissionByToken, getMissionByToken } from "@/lib/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vue publique (le token signé fait office d'auth) — sous-ensemble sûr.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const m = await getMissionByToken(token).catch(() => null);
  if (!m) return Response.json({ error: "lien inconnu" }, { status: 404 });
  return Response.json({
    title: m.title,
    availableRooms: m.availableRooms,
    link: m.link,
    status: m.status,
    ibailReview: m.ibailRecordId
      ? `https://ibail.arpej.fr/edition/records/${m.ibailRecordId}/tenants`
      : null,
    expired: !!(m.goTokenExp && m.goTokenExp < new Date()),
  });
}

// Clic GO → approuve la mission (idempotent).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const res = await approveMissionByToken(token).catch(() => null);
  if (!res || !res.ok) {
    return Response.json({ error: res?.reason ?? "erreur serveur" }, { status: 409 });
  }
  return Response.json({ ok: true, title: res.mission?.title });
}
