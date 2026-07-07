import { authConfigured } from "@/lib/auth";
import { vaultConfigured } from "@/lib/crypto";
import { getVaultSection, setVaultSection } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seules les sections éditables par l'UI — la session iBail reste interne à l'agent.
const EDITABLE = new Set(["guarantors", "applicationProfile"]);

function guard(section: string): Response | null {
  if (!authConfigured()) {
    return Response.json(
      { error: "Configure AUTH_SECRET + AUTH_PASSWORD_HASH avant d'utiliser le coffre" },
      { status: 403 },
    );
  }
  if (!vaultConfigured()) {
    return Response.json({ error: "VAULT_KEY manquante" }, { status: 501 });
  }
  if (!EDITABLE.has(section)) {
    return Response.json({ error: "section inconnue" }, { status: 404 });
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ section: string }> },
) {
  const { section } = await params;
  const blocked = guard(section);
  if (blocked) return blocked;
  try {
    const value = await getVaultSection(section);
    return Response.json({ section, value });
  } catch (err) {
    console.error("[api/vault GET]", err);
    return Response.json({ error: "Lecture du coffre impossible" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ section: string }> },
) {
  const { section } = await params;
  const blocked = guard(section);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    await setVaultSection(section, body?.value ?? null);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/vault PUT]", err);
    return Response.json({ error: "Écriture du coffre impossible" }, { status: 500 });
  }
}
