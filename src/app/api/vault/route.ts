import { authConfigured } from "@/lib/auth";
import { vaultConfigured } from "@/lib/crypto";
import { vaultStatus } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!authConfigured()) {
    return Response.json(
      { error: "Configure AUTH_SECRET + AUTH_PASSWORD_HASH avant d'utiliser le coffre" },
      { status: 403 },
    );
  }
  if (!vaultConfigured()) {
    return Response.json(
      { error: "VAULT_KEY manquante (openssl rand -hex 32)", configured: false },
      { status: 501 },
    );
  }
  try {
    const sections = await vaultStatus();
    return Response.json({ configured: true, sections });
  } catch (err) {
    console.error("[api/vault]", err);
    return Response.json({ error: "Erreur base de données" }, { status: 500 });
  }
}
