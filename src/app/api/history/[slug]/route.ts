import { getHistory } from "@/lib/repo";
import { isValidSlug } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidSlug(slug)) {
    return Response.json({ error: "slug invalide" }, { status: 400 });
  }
  const days = Math.min(
    90,
    Math.max(1, Number(new URL(req.url).searchParams.get("days") || 30)),
  );
  try {
    const points = await getHistory(slug, days);
    return Response.json({ slug, days, points });
  } catch (err) {
    console.error("[api/history]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
