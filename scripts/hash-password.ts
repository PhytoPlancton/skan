/**
 * Génère la valeur AUTH_PASSWORD_HASH à mettre en env var EDJ Labs.
 * Usage : npm run hash-password -- 'ton-mot-de-passe'
 */
import { hashPassword } from "../src/lib/password.ts";

const pw = process.argv[2];
if (!pw) {
  console.error("Usage : npm run hash-password -- 'ton-mot-de-passe'");
  process.exit(1);
}
console.log(`AUTH_PASSWORD_HASH=${hashPassword(pw)}`);
