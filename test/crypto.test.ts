import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  decryptBuffer,
  decryptJson,
  encryptBuffer,
  encryptJson,
} from "../src/lib/crypto.ts";

const key = randomBytes(32);
const otherKey = randomBytes(32);

test("round-trip JSON", () => {
  const value = { garants: [{ nom: "X", revenus: 1800 }], n: 42, s: "éàç€" };
  const enc = encryptJson(value, key);
  assert.deepEqual(decryptJson(enc, key), value);
});

test("round-trip Buffer (binaire type PDF)", () => {
  const plain = randomBytes(1024);
  const enc = encryptBuffer(plain, key);
  assert.deepEqual(decryptBuffer(enc, key), plain);
});

test("deux chiffrements du même clair diffèrent (IV aléatoire)", () => {
  const a = encryptJson({ x: 1 }, key);
  const b = encryptJson({ x: 1 }, key);
  assert.notEqual(a, b);
});

test("mauvaise clé → échec", () => {
  const enc = encryptJson({ secret: true }, key);
  assert.throws(() => decryptJson(enc, otherKey));
});

test("payload altéré → échec (authentification GCM)", () => {
  const enc = encryptJson({ secret: true }, key);
  const raw = Buffer.from(enc, "base64");
  raw[raw.length - 1] ^= 0xff; // flip un bit du ciphertext
  assert.throws(() => decryptBuffer(raw.toString("base64"), key));
});

test("payload tronqué → échec propre", () => {
  assert.throws(() => decryptBuffer(Buffer.from("abc").toString("base64"), key));
});
