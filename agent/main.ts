/**
 * Agent skan — dépose les candidatures iBail à partir de la queue de missions.
 *
 * Boucle (30 s) : réclame UNE mission de son propriétaire (pending mûre →
 * préparation ; approved → soumission). Tout échec inattendu → intervention +
 * notification (jamais de retry agressif).
 *
 * Multi-utilisateur : chaque personne fait tourner SON agent (son PC, son compte
 * iBail, sa boîte mail) avec SON jeton (AGENT_TOKEN). L'agent passe par l'API
 * skan (SKAN_URL) : aucun accès direct à la base ni à la clé du coffre.
 *
 * Modes :
 *   npx tsx agent/main.ts               → boucle normale
 *   npx tsx agent/main.ts --calibrate   → DRY-RUN sur le dossier brouillon existant
 *                                          (ne crée rien, ne soumet rien, screenshots)
 */
import { fetchAllResidences } from "../src/lib/arpej.ts";
import type { ApplicationProfile } from "../src/lib/vault.ts";
import { AgentAuthError, api, type AgentMission } from "./api.ts";
import {
  InterventionError,
  NeedsReservationCode,
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

const DEFAULT_PROFILE: ApplicationProfile = {
  defaultExitDate: "08/08/2028",
  howKnown: "Bouche à oreilles",
  entryDateFloor: "",
};

async function loadProfile(): Promise<ApplicationProfile> {
  const p = await api.getVault<ApplicationProfile>("applicationProfile").catch(() => null);
  return { ...DEFAULT_PROFILE, ...(p ?? {}) };
}

/** Code de réservation (contingent réservataire) pour cette résidence, si enregistré. */
async function getReservationCode(slug: string): Promise<string | null> {
  const codes = await api.getVault<Record<string, string>>("reservationCodes").catch(() => null);
  const c = codes?.[slug];
  return c && c.trim() ? c.trim() : null;
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
async function prepare(mission: AgentMission): Promise<string> {
  const profile = await loadProfile();
  const reservationCode = await getReservationCode(mission.slug);
  return withBrowser(async (ctx, page) => {
    await ensureLoggedIn(ctx, page, mission._id);
    const recordId = await createRecord(page, mission.link, mission._id, reservationCode);
    await api.event(mission._id, "record_created", recordId, recordId);
    await ensureTenant(page, recordId, mission._id);
    await ensureGuarantors(page, recordId, mission._id);
    await checkDocuments(page, recordId, mission._id);
    await prepareReservation(page, recordId, profile, mission._id);
    return recordId;
  });
}

/** Soumet un dossier préparé (après GO ou en full-auto). */
async function submit(mission: AgentMission): Promise<void> {
  const profile = await loadProfile();
  const reservationCode = await getReservationCode(mission.slug);
  await withBrowser(async (ctx, page) => {
    await ensureLoggedIn(ctx, page, mission._id);
    const recordId =
      mission.ibailRecordId ??
      (await createRecord(page, mission.link, mission._id, reservationCode));
    // Re-vérification complète avant l'action irréversible (DOM a pu changer)
    await ensureTenant(page, recordId, mission._id);
    await ensureGuarantors(page, recordId, mission._id);
    await checkDocuments(page, recordId, mission._id);
    await prepareReservation(page, recordId, profile, mission._id);
    await submitReservation(page, recordId, mission._id);
  });
}

async function handlePreparing(mission: AgentMission): Promise<void> {
  const id = mission._id;
  try {
    // Garde anti-place-morte (PC non-24/7 : la mission a pu vieillir).
    if (!(await stillAvailable(mission.slug))) {
      await api.status(id, "expired", "place partie avant traitement", "expired_gone");
      await api.notify(
        `⌛️ skan — la place pour ${mission.title} est partie avant que l'agent ne la traite (PC hors-ligne au bon moment ?). Aucun dépôt tenté.`,
        `skan — place partie : ${mission.title}`,
      );
      return;
    }

    const recordId = await prepare(mission);

    if (mission.mode === "auto") {
      await api.status(id, "submitting", undefined, "auto_submit_start");
      await submit({ ...mission, ibailRecordId: recordId });
      await api.submitted(id, "full-auto");
      console.log(`[agent] ✅ dossier SOUMIS (${mission.title}, full-auto)`);
      return;
    }

    // HYBRIDE : le serveur crée le lien GO (24 h) et l'envoie par SMS.
    await api.ready(id);
    console.log(`[agent] ✓ dossier PRÊT (${mission.title}) — SMS GO envoyé, en attente de ton clic`);
  } catch (err) {
    await handleFailure(mission, err);
  }
}

async function handleSubmitting(mission: AgentMission): Promise<void> {
  try {
    await submit(mission);
    await api.submitted(mission._id, "hybride (GO)");
    console.log(`[agent] ✅ dossier SOUMIS (${mission.title}, hybride)`);
  } catch (err) {
    await handleFailure(mission, err);
  }
}

async function handleFailure(mission: AgentMission, err: unknown): Promise<void> {
  const id = mission._id;
  if (err instanceof AgentAuthError) throw err; // jeton révoqué : on remonte, pas de notif possible
  if (err instanceof SkipMission) {
    await api.status(id, "skipped", err.message, "skipped", err.message);
    console.log(`[agent] mission ${id} skipped: ${err.message}`);
    // Le cas « code de réservation » est actionnable → on prévient (1×/jour via idempotence).
    if (err instanceof NeedsReservationCode) {
      await api.notify(
        `🔐 skan — ${mission.title} : ${err.message} → Settings, champ « Code résa » de la résidence.`,
        `skan — code de réservation requis : ${mission.title}`,
      );
    }
    return;
  }
  if (err instanceof InterventionError) {
    console.error(`[agent] 🚨 intervention requise (${mission.title}): ${err.message}`);
    await api.status(id, "intervention", err.message, "intervention", err.message);
    await api.notify(
      `🚨 skan — INTERVENTION REQUISE pour ${mission.title} : ${err.message}. Rien n'a été soumis. Détails dans skan.`,
      `skan — intervention requise : ${mission.title}`,
    );
    return;
  }
  const msg = (err as Error)?.message ?? String(err);
  console.error(`[agent] ❌ échec (${mission.title}): ${msg.slice(0, 160)}`);
  await api.status(id, "failed", msg, "failed", msg);
  await api.notify(
    `❌ skan — échec technique pour ${mission.title} : ${msg.slice(0, 140)}. Rien n'a été soumis.`,
    `skan — échec : ${mission.title}`,
  );
}

async function tick(): Promise<void> {
  // GO expirés et rappels garants : gérés par le serveur (24/7), plus par l'agent.
  const mission = await api.claim(); // le serveur vérifie agent actif / pause
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
  console.log("=== CALIBRATION RÉUSSIE — captures enregistrées (chiffrées) côté skan ===");
}

async function main(): Promise<void> {
  if (process.argv.includes("--calibrate")) {
    await calibrate();
    process.exit(0);
  }

  // Vérifie SKAN_URL + AGENT_TOKEN dès le démarrage (jeton refusé = fatal, serveur injoignable = on boucle).
  try {
    const me = await api.me();
    console.log(
      `[agent] connecté à skan en tant que « ${me.user} » (agent ${me.agentEnabled ? "actif" : "COUPÉ dans Settings"}) — boucle 30 s, une mission à la fois`,
    );
  } catch (e) {
    if (e instanceof AgentAuthError) throw e;
    console.error(`[agent] skan injoignable pour l'instant (${(e as Error).message}) — nouvel essai toutes les 30 s`);
  }
  let running = true;
  process.once("SIGTERM", () => (running = false));
  process.once("SIGINT", () => (running = false));

  while (running) {
    try {
      await tick();
    } catch (e) {
      if (e instanceof AgentAuthError) {
        console.error(`[agent] ⛔ ${e.message} — régénère le jeton dans skan (Settings → Mon agent) et mets-le dans .env`);
      } else {
        console.error("[agent] tick:", (e as Error)?.message ?? e);
      }
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
