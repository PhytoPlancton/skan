/**
 * Tests d'intégration multi-utilisateur contre un vrai MongoDB.
 *   MONGODB_URI=mongodb://localhost:27018 npm run test:db
 * (base jetable `skan_test_<aléa>`, supprimée à la fin ; ignoré si MONGODB_URI absent)
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

process.env.MONGODB_DB = `skan_test_${randomBytes(4).toString("hex")}`;
process.env.VAULT_KEY = "b".repeat(64);
process.env.NOTIFY_DRY_RUN = "1";

const skip = !process.env.MONGODB_URI;

// Imports dynamiques : db.ts lit l'env au chargement.
const load = async () => ({
  db: await import("../src/lib/db.ts"),
  users: await import("../src/lib/users.ts"),
  repo: await import("../src/lib/repo.ts"),
  settings: await import("../src/lib/settings.ts"),
  vault: await import("../src/lib/vault.ts"),
  missions: await import("../src/lib/missions.ts"),
  crypto: await import("../src/lib/crypto.ts"),
  password: await import("../src/lib/password.ts"),
  screenshots: await import("../src/lib/screenshots.ts"),
});
let m: Awaited<ReturnType<typeof load>>;

before(async () => {
  if (skip) return;
  m = await load();
});

after(async () => {
  if (skip) return;
  const db = await m.db.getDb();
  await db.dropDatabase();
  await db.client.close();
});

test("migration : les données mono-utilisateur sont rattachées à l'admin créé depuis l'env", { skip }, async () => {
  const db = await m.db.getDb();
  // État « v2 mono-utilisateur »
  await db.collection("watches").insertOne({ slug: "eole", title: "Eole", link: "", lastAvailable: false, lastAvailableRooms: 0, createdAt: new Date(), lastNotifiedAt: null });
  await db.collection("alerts").insertOne({ slug: "eole", title: "Eole", link: "", availableRooms: 1, channels: {}, createdAt: new Date() });
  await db.collection("missions").insertOne({ slug: "eole", title: "Eole", link: "", status: "submitted", createdAt: new Date() });
  await db.collection("settings").insertOne({ _id: "app" as never, agentEnabled: true, mode: "hybrid", strategies: { eole: { mode: "love" } } });
  const legacyGarants = [{ lastName: "Parent", taxIncomeN1: "42000" }];
  await db.collection("vault").insertOne({ _id: "guarantors" as never, data: m.crypto.encryptJson(legacyGarants), updatedAt: new Date() });
  const legacyShot = m.crypto.encryptBuffer(Buffer.from("PNG-legacy"));
  const shot = await db.collection("screenshots").insertOne({ missionId: null, step: "x", data: legacyShot, createdAt: new Date() });

  process.env.AUTH_PASSWORD_HASH = m.password.hashPassword("mot-de-passe-admin");
  process.env.ADMIN_USERNAME = "Nico";
  process.env.NOTIFY_PHONE = "+33600000001";
  await m.users.ensureUserIndexes();
  await m.users.bootstrapAndMigrate();
  await m.users.bootstrapAndMigrate(); // idempotent

  const admin = await m.users.getUser("nico");
  assert.ok(admin, "admin créé");
  assert.equal(admin.role, "admin");
  assert.equal(admin.phone, "+33600000001");
  assert.ok(m.password.verifyPassword("mot-de-passe-admin", admin.passwordHash));

  assert.equal((await m.repo.listWatches("nico")).length, 1);
  assert.equal((await m.repo.listAlerts("nico")).length, 1);
  assert.equal((await m.missions.listMissions("nico")).length, 1);
  const s = await m.settings.getSettings("nico");
  assert.equal(s.agentEnabled, true);
  assert.equal(s.strategies.eole?.mode, "love");
  assert.equal(await db.collection("settings").countDocuments({ _id: "app" as never }), 0);
  assert.deepEqual(await m.vault.getVaultSection("nico", "guarantors"), legacyGarants);
  assert.equal(await db.collection("vault").countDocuments({ _id: "guarantors" as never }), 0);
  // ancienne capture (clé maître) toujours lisible par son propriétaire
  assert.equal((await m.screenshots.getScreenshot("nico", shot.insertedId.toHexString()))?.toString(), "PNG-legacy");
});

test("isolation : surveillances, réglages, coffre, missions et captures restent chez leur propriétaire", { skip }, async () => {
  await m.users.createUser({ id: "paul", password: "mot-de-passe-paul" });

  await m.repo.upsertWatch("paul", { slug: "eole", title: "Eole", link: "", lastAvailable: true, lastAvailableRooms: 2 });
  await m.repo.upsertWatch("paul", { slug: "camille", title: "Camille", link: "", lastAvailable: false, lastAvailableRooms: 0 });
  assert.deepEqual((await m.repo.listWatches("paul")).map((w) => w.slug).sort(), ["camille", "eole"]);
  assert.deepEqual((await m.repo.listWatches("nico")).map((w) => w.slug), ["eole"]);
  // même slug surveillé par les deux : états indépendants
  assert.equal((await m.repo.listWatches("nico"))[0].lastAvailable, false);

  assert.equal(await m.repo.removeWatch("paul", "eole"), true);
  assert.equal((await m.repo.listWatches("nico")).length, 1, "supprimer chez paul ne touche pas nico");

  await m.settings.saveSettings("paul", { maxPerDay: 2, _id: "nico" } as never);
  assert.equal((await m.settings.getSettings("paul")).maxPerDay, 2);
  assert.equal((await m.settings.getSettings("nico")).agentEnabled, true, "réglages de nico intacts");

  await m.vault.setVaultSection("paul", "guarantors", [{ lastName: "Garant-de-Paul" }]);
  assert.deepEqual(await m.vault.getVaultSection("paul", "guarantors"), [{ lastName: "Garant-de-Paul" }]);
  assert.deepEqual(await m.vault.getVaultSection("nico", "guarantors"), [{ lastName: "Parent", taxIncomeN1: "42000" }]);
  assert.deepEqual((await m.vault.vaultStatus("paul")).map((x) => x.section), ["guarantors"]);
  // le blob de paul ne se déchiffre pas avec la clé de nico
  const db = await m.db.getDb();
  const raw = await db.collection<{ _id: string; data: string }>("vault").findOne({ _id: "paul:guarantors" });
  assert.throws(() => m.crypto.decryptJson(raw!.data, m.crypto.userKey("nico")));

  const base = { slug: "eole", title: "Eole", link: "", availableRooms: 1, status: "pending" as const, mode: "hybrid" as const, dryRun: false, notBefore: new Date(Date.now() - 1000) };
  assert.equal((await m.missions.createMissionIfNone({ ...base, userId: "paul" })).created, true);
  assert.equal((await m.missions.createMissionIfNone({ ...base, userId: "paul" })).created, false, "idempotent par utilisateur");
  assert.equal((await m.missions.createMissionIfNone({ ...base, userId: "nico" })).created, true, "nico peut viser la même résidence");
  assert.equal(await m.missions.hasMissionToday("paul", "eole"), true);
  assert.equal(await m.missions.hasMissionToday("paul", "camille"), false);

  const claimed = await m.missions.claimNextMission("paul");
  assert.equal(claimed?.userId, "paul");
  assert.equal(await m.missions.claimNextMission("paul"), null, "une seule mission de paul");
  const nicoMission = await m.missions.claimNextMission("nico");
  assert.equal(nicoMission?.userId, "nico");
  assert.equal(await m.missions.getUserMission("paul", nicoMission!._id!.toHexString()), null, "paul ne peut pas lire la mission de nico");

  // updateMission filtré par propriétaire : paul ne peut pas modifier la mission de nico
  await m.missions.updateMission("paul", nicoMission!._id!, { status: "failed" });
  assert.equal((await m.missions.getUserMission("nico", nicoMission!._id!.toHexString()))?.status, "preparing");

  const counters = await m.missions.applyCounters("paul");
  assert.equal(counters.active, 1);

  const sid = await m.screenshots.saveScreenshot("paul", claimed!._id!, "etape", Buffer.from("PNG-paul"));
  assert.equal((await m.screenshots.getScreenshot("paul", sid.toHexString()))?.toString(), "PNG-paul");
  assert.equal(await m.screenshots.getScreenshot("nico", sid.toHexString()), null);
});

test("jeton d'agent : lié à un seul compte, révocable, régénération invalide l'ancien", { skip }, async () => {
  const t1 = await m.users.rotateAgentToken("paul");
  assert.match(t1!, /^skan_[0-9a-f]{64}$/);
  assert.equal((await m.users.findUserByAgentToken(t1!))?._id, "paul");
  const t2 = await m.users.rotateAgentToken("paul");
  assert.equal(await m.users.findUserByAgentToken(t1!), null, "ancien jeton invalidé");
  assert.equal((await m.users.findUserByAgentToken(t2!))?._id, "paul");
  const stored = await m.users.getUser("paul");
  assert.notEqual(stored?.agentTokenHash, t2, "jamais stocké en clair");
  await m.users.updateUser("paul", { disabled: true });
  assert.equal(await m.users.findUserByAgentToken(t2!), null, "compte désactivé → jeton refusé");
  await m.users.updateUser("paul", { disabled: false });
  await m.users.revokeAgentToken("paul");
  assert.equal(await m.users.findUserByAgentToken(t2!), null);
  assert.equal(await m.users.findUserByAgentToken("skan_" + "0".repeat(64)), null);
});

test("suppression d'un compte : toutes ses données partent, celles des autres restent", { skip }, async () => {
  await m.users.deleteUserAndData("paul");
  assert.equal(await m.users.getUser("paul"), null);
  const db = await m.db.getDb();
  for (const c of ["watches", "alerts", "missions", "screenshots", "vault"]) {
    assert.equal(await db.collection(c).countDocuments({ userId: "paul" }), 0, c);
  }
  assert.equal((await m.repo.listWatches("nico")).length, 1);
  assert.ok(await m.vault.getVaultSection("nico", "guarantors"));
});
