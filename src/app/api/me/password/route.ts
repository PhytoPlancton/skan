import { requireUser } from "@/lib/current-user";
import { verifyPassword } from "@/lib/password";
import { updateUser, validatePassword } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changer mon mot de passe (exige l'actuel). */
export async function POST(req: Request) {
  const g = await requireUser();
  if (g.error) return g.error;
  const body = await req.json().catch(() => ({}));
  if (!verifyPassword(String(body.current ?? ""), g.user.passwordHash)) {
    return Response.json({ error: "mot de passe actuel incorrect" }, { status: 400 });
  }
  const invalid = validatePassword(body.next);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  await updateUser(g.user._id, { password: String(body.next), mustChangePassword: false });
  return Response.json({ ok: true });
}
