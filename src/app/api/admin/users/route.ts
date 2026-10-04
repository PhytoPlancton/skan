import { requireAdmin } from "@/lib/current-user";
import {
  createUser,
  getUser,
  listUsers,
  normalizeEmail,
  normalizePhone,
  normalizeUserId,
  toPublic,
  validatePassword,
} from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (g.error) return g.error;
  return Response.json({ users: (await listUsers()).map(toPublic) });
}

/** Créer un compte : { username, password, phone?, email?, role? }. */
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  const id = normalizeUserId(body.username);
  if (!id) {
    return Response.json(
      { error: "identifiant invalide (2-32 caractères : minuscules, chiffres, - ou _)" },
      { status: 400 },
    );
  }
  const invalid = validatePassword(body.password);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  const phone = normalizePhone(body.phone);
  if (phone === null) return Response.json({ error: "téléphone invalide (format +33…)" }, { status: 400 });
  const email = normalizeEmail(body.email);
  if (email === null) return Response.json({ error: "email invalide" }, { status: 400 });
  if (await getUser(id)) return Response.json({ error: "identifiant déjà pris" }, { status: 409 });

  const user = await createUser({
    id,
    password: String(body.password),
    role: body.role === "admin" ? "admin" : "user",
    phone,
    email,
  });
  return Response.json({ ok: true, user: toPublic(user) });
}
