/**
 * Crée (ou réinitialise) un compte en ligne de commande.
 *   npm run create-user -- <identifiant> <mot-de-passe> [admin] [+33612345678] [email]
 * Utile en local ou si aucun compte admin n'existe (sinon : page /admin de l'app).
 */
import { getDb } from "../src/lib/db.ts";
import {
  createUser,
  ensureUserIndexes,
  getUser,
  normalizeEmail,
  normalizePhone,
  normalizeUserId,
  updateUser,
  validatePassword,
} from "../src/lib/users.ts";

async function main() {
  const [rawId, password, roleArg, phoneArg, emailArg] = process.argv.slice(2);
  const id = normalizeUserId(rawId);
  if (!id || !password) {
    console.error("Usage : npm run create-user -- <identifiant> <mot-de-passe> [admin|user] [+33…] [email]");
    process.exit(1);
  }
  const invalid = validatePassword(password);
  if (invalid) throw new Error(invalid);
  const phone = normalizePhone(phoneArg) ?? "";
  const email = normalizeEmail(emailArg) ?? "";
  await ensureUserIndexes();
  if (await getUser(id)) {
    await updateUser(id, { password });
    console.log(`✓ mot de passe de « ${id} » réinitialisé`);
  } else {
    await createUser({ id, password, role: roleArg === "admin" ? "admin" : "user", phone, email });
    console.log(`✓ compte « ${id} » créé (${roleArg === "admin" ? "admin" : "user"})`);
  }
  (await getDb()).client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
