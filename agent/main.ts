/**
 * Agent skan — dépose les candidatures iBail à partir de la queue de missions.
 *
 * Boucle (30 s) : expire les GO périmés, rappelle les garants, puis traite UNE
 * mission (pending mûre → préparation ; approved → soumission). Tout échec
 * inattendu → intervention + notification (jamais de retry agressif).
 *
 * Modes :
 *   npx tsx agent/main.ts               → boucle normale
 *   npx tsx agent/main.ts --calibrate   → DRY-RUN sur le dossier brouillon existant
 *                                          (ne crée rien, ne soumet rien, screenshots)
 */
import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";

import { fetchAllResidences } from "../src/lib/arpej.ts";
import {
  claimNextMission,
  expireStaleGoMissions,
  updateMission,
  type MissionDoc,
} from "../src/lib/missions.ts";
import { notifyText } from "../src/lib/notifier.ts";
import { getSettings, incrementHybridSuccess } from "../src/lib/settings.ts";
import { getVaultSection } from "../src/lib/vault.ts";
import type { ApplicationProfile } from "../src/lib/vault.ts";
import { getDb } from "../src/lib/db.ts";
import {
  InterventionError,
  SkipMission,
  checkDocuments,
  createRecord,
  ensureGuarantors,
  ensureLoggedIn,
  ensureTenant,
  findDraftRecord,
  prepareReservation,
  submitReservation,
  withBrowser,
} from "./ibail.ts";

const LOOP_MS = 30_000;
const PUBLIC_URL = process.env.PUBLIC_APP_URL || "https://skan.nmt.ovh";

const DEFAULT_PROFILE: ApplicationProfile = {
  defaultExitDate: "08/08/2028",
  howKnown: "Bouche à oreilles",
  entryDateFloor: "",
};

async function loadProfile(): Promise<ApplicationProfile> {
  const p = await getVaultSection<ApplicationProfile>("applicationProfile").catch(() => null);
  return { ...DEFAULT_PROFILE, ...(p ?? {}) };
}

/**
 * La place est-elle encore réellement disponible ? (garde utile quand l'agent
 * tourne sur un PC non-24/7 : une mission peut avoir vieilli pendant l'arrêt.)
 * En cas d'erreur réseau on ne bloque pas — createRecord détecte l'absence de lot.
 */
async function stillAvailable(slug: string): Promise<boolean> {
  try {
    const list = await fetchAllResidences();
    return list.some((r) => r.slug === slug && r.availableRooms > 0);
  } catch {
    return true;
  }
}

/** Prépare le dossier complet (étapes 1→4) sans soumettre. Renvoie le recordId. */
async function prepare(mission: MissionDoc): Promise<string> {
  const profile = await loadProfile();
  return withBrowser(async (ctx, page) => {
    await ensureLoggedIn(ctx, page, mission._id!);
    const recordId = await createRecord(page, mission.link, mission._id!);
    await updateMission(mission._id!, { ibailRecordId: recordId }, "record_created", recordId);
    await ensureTenant(page, recordId, mission._id!);
    await ensureGuarantors(page, recordId, mission._id!);
    await checkDocuments(page, recordId, mission._id!);
    await prepareReservation(page, recordId, profile, mission._id!);
    return recordId;
  });
}

/** Soumet un dossier préparé (après GO ou en full-auto). */
async function submit(mission: MissionDoc): Promise<void> {
  const profile = await loadProfile();
  await withBrowser(async (ctx, page) => {
    await ensureLoggedIn(ctx, page, mission._id!);
    const recordId =
      mission.ibailRecordId ?? (await createRecord(page, mission.link, mission._id!));
    // Re-vérification complète avant l'action irréversible (DOM a pu changer)
    await ensureTenant(page, recordId, mission._id!);
    await ensureGuarantors(page, recordId, mission._id!);
    await checkDocuments(page, recordId, mission._id!);
    await prepareReservation(page, recordId, profile, mission._id!);
    await submitReservation(page, recordId, mission._id!);
  });
}

async function handlePreparing(mission: MissionDoc): Promise<void> {
  const id = mission._id!;
  try {
    // Garde anti-place-morte (PC non-24/7 : la mission a pu vieillir).
    if (!(await stillAvailable(mission.slug))) {
      await updateMission(
        id,
        { status: "expired", reason: "place partie avant traitement" },
        "expired_gone",
      );
      await notifyText(
        `⌛️ skan — la place pour ${mission.title} est partie avant que l'agent ne la traite (PC hors-ligne au bon moment ?). Aucun dépôt tenté.`,
        `skan — place partie : ${mission.title}`,
      );
      return;
    }

    const recordId = await prepare(mission);

    if (mission.mode === "auto") {
      await updateMission(id, { status: "submitting" }, "auto_submit_start");
      await submit({ ...mission, ibailRecordId: recordId });
      await markSubmitted(mission, "full-auto");
      return;
    }

    // HYBRIDE : lien GO (24 h)
    const token = randomBytes(24).toString("hex");
    const exp = new Date(Date.now() + 24 * 3_600_000);
    await updateMission(
      id,
      { status: "awaiting_go", goToken: token, goTokenExp: exp },
      "awaiting_go",
    );
    await notifyText(
      `🤖 skan — dossier PRÊT pour ${mission.title} (${mission.availableRooms} dispo). Tout est rempli, rien n'est envoyé. GO (24 h) : ${PUBLIC_URL}/go/${token}`,
      `skan — GO ? ${mission.title}`,
      `${PUBLIC_URL}/go/${token}`,
    );
  } catch (err) {
    await handleFailure(mission, err);
  }
}

async function handleSubmitting(mission: MissionDoc): Promise<void> {
  try {
    await submit(mission);
    await markSubmitted(mission, "hybride (GO)");
    if (mission.mode === "hybrid") await incrementHybridSuccess();
  } catch (err) {
    await handleFailure(mission, err);
  }
}

async function markSubmitted(mission: MissionDoc, how: string): Promise<void> {
  await updateMission(
    mission._id!,
    { status: "submitted", submittedAt: new Date() },
    "submitted",
    how,
  );
  // Rappel garants H+4
  const db = await getDb();
  await db
    .collection("missions")
    .updateOne(
      { _id: mission._id },
      { $set: { remindGuarantorsAt: new Date(Date.now() + 4 * 3_600_000) } },
    );
  await notifyText(
    `✅ skan — dossier SOUMIS pour ${mission.title} (${how}). 📩 Important : tes garants doivent cliquer le lien de validation reçu par email — préviens-les maintenant.`,
    `skan — dossier soumis : ${mission.title}`,
  );
}

async function handleFailure(mission: MissionDoc, err: unknown): Promise<void> {
  const id = mission._id!;
  if (err instanceof SkipMission) {
    await updateMission(id, { status: "skipped", reason: err.message }, "skipped", err.message);
    console.log(`[agent] mission ${id} skipped: ${err.message}`);
    return;
  }
  if (err instanceof InterventionError) {
    await updateMission(
      id,
      { status: "intervention", reason: err.message },
      "intervention",
      err.message,
    );
    await notifyText(
      `🚨 skan — INTERVENTION REQUISE pour ${mission.title} : ${err.message}. Rien n'a été soumis. Détails : ${PUBLIC_URL}`,
      `skan — intervention requise : ${mission.title}`,
    );
    return;
  }
  const msg = (err as Error)?.message ?? String(err);
  await updateMission(id, { status: "failed", reason: msg }, "failed", msg);
  await notifyText(
    `❌ skan — échec technique pour ${mission.title} : ${msg.slice(0, 140)}. Rien n'a été soumis.`,
    `skan — échec : ${mission.title}`,
  );
}

async function remindGuarantors(): Promise<void> {
  const db = await getDb();
  const due = await db
    .collection<MissionDoc & { remindGuarantorsAt?: Date; guarantorsReminded?: boolean }>(
      "missions",
    )
    .find({
      status: "submitted",
      remindGuarantorsAt: { $lte: new Date() },
      guarantorsReminded: { $ne: true },
    })
    .toArray();
  for (const m of due) {
    await db
      .collection("missions")
      .updateOne({ _id: m._id }, { $set: { guarantorsReminded: true } });
    await notifyText(
      `⏰ skan — rappel : si tes garants n'ont pas encore validé le dossier ${m.title} (lien reçu par email il y a ~4 h), relance-les — le dossier reste incomplet sans eux.`,
      `skan — rappel garants : ${m.title}`,
    );
  }
}

async function tick(): Promise<void> {
  const expired = await expireStaleGoMissions();
  for (const m of expired) {
    await notifyText(
      `⌛️ skan — le lien GO pour ${m.title} a expiré (24 h) sans clic. Aucune soumission. La place est peut-être encore dispo : ${m.link}`,
      `skan — GO expiré : ${m.title}`,
    );
  }

  await remindGuarantors();

  const settings = await getSettings();
  if (!settings.agentEnabled) return;
  if (settings.pausedUntil && new Date(settings.pausedUntil) > new Date()) return;

  const mission = await claimNextMission();
  if (!mission) return;

  console.log(`[agent] mission ${mission._id} (${mission.slug}) → ${mission.status}`);
  if (mission.status === "preparing") await handlePreparing(mission);
  else if (mission.status === "submitting") await handleSubmitting(mission);
}

/** DRY-RUN de calibration : parcourt le dossier brouillon existant, ne crée rien, ne soumet rien. */
async function calibrate(): Promise<void> {
  console.log("=== CALIBRATION (dry-run, zéro écriture définitive) ===");
  const profile = await loadProfile();
  await withBrowser(async (ctx, page) => {
    await ensureLoggedIn(ctx, page, null);
    console.log("✓ session iBail OK");
    const recordId = await findDraftRecord(page);
    console.log(`✓ dossier brouillon trouvé : #${recordId}`);
    await ensureTenant(page, recordId, null);
    console.log("✓ étape 1 candidat OK (réutilisation)");
    await ensureGuarantors(page, recordId, null);
    console.log("✓ étape 2 garants OK");
    await checkDocuments(page, recordId, null);
    console.log("✓ étape 3 pièces toutes présentes");
    await prepareReservation(page, recordId, profile, null);
    console.log("✓ étape 4 pré-remplie (NON soumise)");
  });
  console.log("=== CALIBRATION RÉUSSIE — captures en base (collection screenshots) ===");
}

async function main(): Promise<void> {
  if (process.argv.includes("--calibrate")) {
    await calibrate();
    process.exit(0);
  }

  console.log("[agent] démarrage — boucle 30 s, une mission à la fois");
  let running = true;
  process.once("SIGTERM", () => (running = false));
  process.once("SIGINT", () => (running = false));

  while (running) {
    try {
      await tick();
    } catch (e) {
      console.error("[agent] tick:", (e as Error)?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
  console.log("[agent] arrêt propre");
  process.exit(0);
}

main().catch((e) => {
  console.error("[agent] fatal:", e);
  process.exit(1);
});
