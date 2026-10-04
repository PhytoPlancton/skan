import { requireUser } from "@/lib/current-user";
import { vaultConfigured } from "@/lib/crypto";
import { vaultStatus } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (g.error) return g.error;
  if (!vaultConfigured()) {
    return Response.json(
      { error: "VAULT_KEY manquante (openssl rand -hex 32)", configured: false },
      { status: 501 },
    );
  }
  try {
    const sections = await vaultStatus(g.user._id);
    return Response.json({ configured: true, sections });
  } catch (err) {
    console.error("[api/vault]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
