import { requireAgent } from "@/lib/current-user";
import { vaultConfigured } from "@/lib/crypto";
import { getVaultSection, setVaultSection } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moindre privilège : l'agent lit le strict nécessaire (jamais les garants) et
// n'écrit que sa session iBail.
const READABLE = new Set(["applicationProfile", "reservationCodes", "ibailSession"]);
const WRITABLE = new Set(["ibailSession"]);

type Ctx = { params: Promise<{ section: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const { section } = await params;
  if (!READABLE.has(section)) return Response.json({ error: "section interdite" }, { status: 403 });
  if (!vaultConfigured()) return Response.json({ error: "VAULT_KEY manquante" }, { status: 501 });
  const value = await getVaultSection(g.user._id, section);
  return Response.json({ section, value });
}

export async function PUT(req: Request, { params }: Ctx) {
  const g = await requireAgent(req);
  if (g.error) return g.error;
  const { section } = await params;
  if (!WRITABLE.has(section)) return Response.json({ error: "section interdite" }, { status: 403 });
  if (!vaultConfigured()) return Response.json({ error: "VAULT_KEY manquante" }, { status: 501 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return Response.json({ error: "trop volumineux" }, { status: 413 });
  let value: unknown = null;
  try {
    value = JSON.parse(raw)?.value ?? null;
  } catch {
    return Response.json({ error: "JSON invalide" }, { status: 400 });
  }
  await setVaultSection(g.user._id, section, value);
  return Response.json({ ok: true });
}
