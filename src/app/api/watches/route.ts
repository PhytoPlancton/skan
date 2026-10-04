import { lookupResidencePage, slugFromLink } from "@/lib/arpej";
import { requireUser } from "@/lib/current-user";
import { statusForSlug } from "@/lib/checker";
import { getResidencesCached } from "@/lib/residences";
import { listWatches, upsertWatch } from "@/lib/repo";
import { isValidSlug, prettifySlug } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  try {
    const watches = await listWatches(g.user._id);
    return Response.json({ watches });
  } catch (err) {
    console.error("[api/watches GET]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}

/** Surveiller une résidence : { slug } ou { url } (lien arpej.fr de la résidence). */
export async function POST(req: Request) {
  const g = await requireUser();
  if (g.error) return g.error;
  let body: { url?: string; slug?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body vide */
  }

  let slug = (body.slug || "").trim().toLowerCase();
  if (!slug && body.url) {
    const raw = String(body.url).trim();
    let host = "";
    try {
      host = new URL(raw).hostname;
    } catch {
      /* pas une URL */
    }
    if (!/(^|\.)arpej\.fr$/i.test(host) || !/\/residence\//.test(raw)) {
      return Response.json(
        { error: "Colle le lien d'une page résidence arpej.fr (ex. https://www.arpej.fr/fr/residence/…/)" },
        { status: 400 },
      );
    }
    slug = slugFromLink(raw).toLowerCase();
  }

  if (!slug || !isValidSlug(slug)) {
    return Response.json(
      { error: "Fournis un slug ARPEJ valide ou l'URL d'une résidence arpej.fr" },
      { status: 400 },
    );
  }

  try {
    const residences = await getResidencesCached();
    const bySlug = new Map(residences.map((r) => [r.slug, r]));
    let fallbackTitle = prettifySlug(slug);

    // Absente de l'API (0 logement aujourd'hui) : on vérifie qu'elle existe vraiment.
    if (!bySlug.has(slug)) {
      const page = await lookupResidencePage(slug);
      if (page && !page.exists) {
        return Response.json(
          { error: "Cette résidence est introuvable sur arpej.fr — vérifie le lien" },
          { status: 404 },
        );
      }
      if (page?.exists && page.title) fallbackTitle = page.title;
    }

    const status = statusForSlug(slug, bySlug, fallbackTitle);

    // Baseline silencieuse : on n'alerte pas pour une dispo déjà visible.
    await upsertWatch(g.user._id, {
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
