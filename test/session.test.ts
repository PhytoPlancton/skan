import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionValue, verifySessionValue } from "../src/lib/session.ts";
import { decryptJson, encryptJson, userKey } from "../src/lib/crypto.ts";

const SECRET = "s".repeat(64);

test("session : renvoie l'identifiant signé", async () => {
  const v = await createSessionValue("alice", SECRET);
  assert.equal(await verifySessionValue(v, SECRET), "alice");
});

test("session : identité falsifiée → refusée", async () => {
  const v = await createSessionValue("alice", SECRET);
  const forged = v.replace(/^alice\./, "bob.");
  assert.equal(await verifySessionValue(forged, SECRET), null);
});

test("session : mauvais secret, format invalide, ancien cookie mono-utilisateur → refusés", async () => {
  const v = await createSessionValue("alice", SECRET);
  assert.equal(await verifySessionValue(v, "autre-secret"), null);
  assert.equal(await verifySessionValue("n'importe quoi", SECRET), null);
  assert.equal(await verifySessionValue("1999999999.deadbeef", SECRET), null);
  assert.equal(await verifySessionValue(undefined, SECRET), null);
});

test("coffre : chaque utilisateur a sa clé, celle d'un autre ne déchiffre pas", () => {
  process.env.VAULT_KEY = "a".repeat(64);
  const enc = encryptJson({ revenus: 1800 }, userKey("alice"));
  assert.deepEqual(decryptJson(enc, userKey("alice")), { revenus: 1800 });
  assert.throws(() => decryptJson(enc, userKey("bob")));
  assert.throws(() => decryptJson(enc)); // ni avec la clé maître brute
});
