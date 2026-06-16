import { slugFromLink } from "@/lib/arpej";
import { statusForSlug } from "@/lib/checker";
import { getResidencesCached } from "@/lib/residences";
import { listWatches, upsertWatch } from "@/lib/repo";
import { isValidSlug, prettifySlug } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const watches = await listWatches();
    return Response.json({ watches });
  } catch (err) {
    console.error("[api/watches GET]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { url?: string; slug?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body vide */
  }

  let slug = (body.slug || "").trim().toLowerCase();
  if (!slug && body.url) slug = slugFromLink(String(body.url).trim());

  if (!slug || !isValidSlug(slug)) {
    return Response.json(
      { error: "Fournis un slug ARPEJ valide ou l'URL d'une résidence arpej.fr" },
      { status: 400 },
    );
  }

  try {
    const residences = await getResidencesCached();
    const bySlug = new Map(residences.map((r) => [r.slug, r]));
    const status = statusForSlug(slug, bySlug, prettifySlug(slug));

    // Baseline silencieuse : on n'alerte pas pour une dispo déjà visible.
    await upsertWatch({
      slug,
      title: status.title,
      link: status.link,
      lastAvailable: status.available,
      lastAvailableRooms: status.availableRooms,
    });

    return Response.json({ ok: true, slug, status });
  } catch (err) {
    console.error("[api/watches POST]", err);
    return Response.json({ error: "Erreur lors de l'ajout" }, { status: 500 });
  }
}
