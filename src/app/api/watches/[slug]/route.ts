import { requireUser } from "@/lib/current-user";
import { removeWatch } from "@/lib/repo";
import { isValidSlug } from "@/lib/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const g = await requireUser();
  if (g.error) return g.error;
  const { slug } = await params;
  if (!isValidSlug(slug)) {
    return Response.json({ error: "slug invalide" }, { status: 400 });
  }
  try {
    const removed = await removeWatch(g.user._id, slug);
    return Response.json({ ok: true, removed });
  } catch (err) {
    console.error("[api/watches DELETE]", err);
    return Response.json({ error: "Erreur lors de la suppression" }, { status: 500 });
  }
}
