/**
 * Pilotage iBail (Playwright). Philosophie : ZÉRO improvisation —
 * chaque étape vérifie ce qu'elle attend ; élément introuvable ou état
 * inattendu → InterventionError (stop + alerte humaine), jamais de forçage.
 * Les délais entre actions sont humains (aléatoires), une mission à la fois.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import type { ObjectId } from "mongodb";

import { getVaultSection, setVaultSection } from "../src/lib/vault.ts";
import type { ApplicationProfile } from "../src/lib/vault.ts";
import { saveScreenshot } from "../src/lib/screenshots.ts";
import { fetchMagicLink, MailboxAuthError } from "./mailbox.ts";

const IBAIL = "https://ibail.arpej.fr";

/** Étape irrécupérable automatiquement → humain requis. */
export class InterventionError extends Error {}
/** Mission sans objet (ex. dossier déjà en cours pour ce lot). */
export class SkipMission extends Error {}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pause « humaine » entre deux actions. */
const humanPause = () => sleep(rand(500, 1600));

export interface AgentRun<T> {
  (ctx: BrowserContext, page: Page): Promise<T>;
}

/** Ouvre un navigateur avec la session iBail persistée (coffre). */
export async function withBrowser<T>(fn: AgentRun<T>): Promise<T> {
  const browser: Browser = await chromium.launch({
    headless: true,
    slowMo: 60,
  });
  try {
    const state = await getVaultSection<object>("ibailSession").catch(() => null);
    const ctx = await browser.newContext({
      storageState: (state as never) ?? undefined,
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    return await fn(ctx, page);
  } finally {
    await browser.close();
  }
}

async function shoot(page: Page, missionId: ObjectId | null, step: string): Promise<void> {
  try {
    const png = await page.screenshot({ fullPage: false });
    await saveScreenshot(missionId, step, png);
  } catch (e) {
    console.error("[agent] screenshot:", (e as Error).message);
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // Connecté : la page « Mes dossiers » est accessible (pas de champ email de login).
  if (await page.getByText(/mes dossiers/i).first().isVisible().catch(() => false)) {
    return true;
  }
  const emailField = page.locator('input[type="email"]').first();
  return !(await emailField.isVisible().catch(() => false));
}

/** Garantit une session iBail valide (relogin par magic link si besoin). */
export async function ensureLoggedIn(
  ctx: BrowserContext,
  page: Page,
  missionId: ObjectId | null,
): Promise<void> {
  await page.goto(`${IBAIL}/records`, { waitUntil: "domcontentloaded" });
  await humanPause();
  if (await isLoggedIn(page)) return;

  const email = process.env.IBAIL_EMAIL;
  if (!email) throw new InterventionError("IBAIL_EMAIL manquant dans l'environnement");

  console.log("[agent] session expirée → demande de magic link");
  const requestedAt = new Date(Date.now() - 60_000);

  const emailInput = page.locator('input[type="email"], input[name*="mail" i]').first();
  if (!(await emailInput.isVisible().catch(() => false))) {
    await shoot(page, missionId, "login_page_inattendue");
    throw new InterventionError("page de connexion iBail inattendue (champ email introuvable)");
  }
  await emailInput.fill(email);
  await humanPause();
  console.log(`[agent] email saisi (${email}), envoi de la demande de lien`);

  const submit = page
    .locator("button, input[type=submit]")
    .filter({ hasText: /connexion|connecter|envoyer|recevoir|valider/i })
    .first();
  if (!(await submit.isVisible().catch(() => false))) {
    await shoot(page, missionId, "login_bouton_introuvable");
    throw new InterventionError("bouton d'envoi du lien de connexion introuvable");
  }
  await submit.click();
  console.log("[agent] demande envoyée → lecture du mail (IMAP Gmail)…");

  let link: string | null;
  try {
    link = await fetchMagicLink(requestedAt);
  } catch (e) {
    if (e instanceof MailboxAuthError) throw new InterventionError((e as Error).message);
    throw e;
  }
  if (!link) {
    throw new InterventionError(
      "magic link iBail non reçu/illisible en 3 min — vérifie l'app password Gmail et que le mail arrive bien",
    );
  }
  console.log("[agent] lien reçu → navigation vers la session");
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await humanPause();
  await page.goto(`${IBAIL}/records`, { waitUntil: "domcontentloaded" });
  if (!(await isLoggedIn(page))) {
    await shoot(page, missionId, "login_echec");
    throw new InterventionError("connexion via magic link échouée (page après lien inattendue)");
  }
  await setVaultSection("ibailSession", await ctx.storageState());
  console.log("[agent] session iBail régénérée et persistée ✓");
}

/** Ferme les bandeaux cookies ET retire les popups bloquants (best effort). */
async function killOverlays(page: Page): Promise<void> {
  const accept = page
    .locator("button, a")
    .filter({ hasText: /tout accepter|accepter|j'accepte|ok pour moi/i })
    .first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click().catch(() => {});
    await sleep(400);
  }
  // Popups qui interceptent les clics (arpej.fr : #my-popup) → retirés du DOM.
  await page
    .evaluate(() => {
      for (const sel of ["#my-popup", ".newsletter-popup", ".modal-newsletter", "#sib-container"]) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }
    })
    .catch(() => {});
}

/**
 * Crée le dossier pour la résidence (bouton « Je dépose mon dossier »)
 * et renvoie l'id du record iBail. Détecte le doublon (→ SkipMission).
 */
export async function createRecord(
  page: Page,
  residenceLink: string,
  missionId: ObjectId | null,
): Promise<string> {
  await page.goto(residenceLink, { waitUntil: "domcontentloaded" });
  await killOverlays(page);
  await humanPause();

  // Le CTA arpej.fr « Je dépose mon dossier » pointe (href) vers iBail et s'ouvre
  // en _blank ; un popup peut masquer le clic → on suit directement le href.
  const depositCta = page
    .locator("a, button")
    .filter({ hasText: /je d[ée]pose mon dossier/i })
    .first();
  const ctaHref = (await depositCta.count().catch(() => 0))
    ? await depositCta.getAttribute("href").catch(() => null)
    : null;
  if (ctaHref && ctaHref.startsWith(IBAIL)) {
    await page.goto(ctaHref, { waitUntil: "domcontentloaded" });
  } else if (await depositCta.isVisible().catch(() => false)) {
    await depositCta.click().catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  } else {
    await shoot(page, missionId, "cta_depot_introuvable");
    throw new InterventionError("bouton « Je dépose mon dossier » introuvable sur la page résidence");
  }
  await killOverlays(page);
  await humanPause();
  if (!page.url().startsWith(IBAIL)) {
    await shoot(page, missionId, "redirection_ibail_echec");
    throw new InterventionError(`pas arrivé sur iBail (url: ${page.url()})`);
  }

  // Sur iBail : bloc(s) de lot avec bouton « Je dépose mon dossier »
  const lotCta = page
    .locator("a, button")
    .filter({ hasText: /je d[ée]pose mon dossier/i })
    .first();
  if (!(await lotCta.isVisible().catch(() => false))) {
    await shoot(page, missionId, "lot_cta_introuvable");
    throw new InterventionError("aucun lot avec « Je dépose mon dossier » sur iBail (place déjà partie ?)");
  }
  await killOverlays(page);
  await shoot(page, missionId, "lots_disponibles");
  await lotCta.click().catch(async () => {
    await lotCta.click({ force: true }).catch(() => {});
  });
  await humanPause();

  // Modal de confirmation « Dépôt de dossier — Êtes-vous sûr… » → Oui
  const oui = page.locator("button, a").filter({ hasText: /^oui$/i }).first();
  if (await oui.isVisible().catch(() => false)) {
    await oui.click();
    await page.waitForLoadState("domcontentloaded");
  }
  await sleep(2500);

  // Doublon : « Vous avez déjà un dossier en cours pour ce lot. »
  if (
    await page
      .getByText(/d[ée]j[àa] un dossier en cours/i)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    throw new SkipMission("iBail : dossier déjà en cours pour ce lot");
  }

  // Après « Oui », iBail ouvre LE NOUVEAU dossier → son id est dans l'URL.
  // NE PAS prendre le 1er de « Mes dossiers » : ce serait potentiellement un AUTRE dossier.
  console.log("[agent][diag] URL après dépôt:", page.url());
  const m = page.url().match(/\/edition\/records\/(\d+)/);
  if (!m) {
    await shoot(page, missionId, "record_id_introuvable");
    const txt = (await page.locator("body").innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 300);
    console.log("[agent][diag] pas d'id dans l'URL, contenu:", txt);
    throw new InterventionError(
      "dossier créé mais id absent de l'URL après dépôt (voir [diag]) — ciblage à ajuster",
    );
  }
  await shoot(page, missionId, "record_cree");
  return m[1];
}

/** Récupère le record « en cours de création » le plus récent (mode calibration). */
export async function findDraftRecord(page: Page): Promise<string> {
  await page.goto(`${IBAIL}/records`, { waitUntil: "domcontentloaded" });
  await humanPause();
  const links = page.locator('a[href*="/edition/records/"]');
  const n = await links.count();
  if (n === 0) throw new InterventionError("aucun dossier éditable dans « Mes dossiers »");
  const href = await links.first().getAttribute("href");
  const m = href?.match(/\/edition\/records\/(\d+)/);
  if (!m) throw new InterventionError("id de dossier introuvable");
  return m[1];
}

/** Navigue vers une étape du dossier via le stepper (libellé exact des captures). */
async function gotoStep(page: Page, recordId: string, step: RegExp): Promise<void> {
  if (!page.url().includes(`/edition/records/${recordId}`)) {
    await page.goto(`${IBAIL}/edition/records/${recordId}/tenants`, {
      waitUntil: "domcontentloaded",
    });
    await humanPause();
  }
  const stepLink = page.locator("a, button, [role=link]").filter({ hasText: step }).first();
  if (!(await stepLink.isVisible().catch(() => false))) {
    throw new InterventionError(`étape ${step} introuvable dans le stepper`);
  }
  await stepLink.click();
  await page.waitForLoadState("domcontentloaded");
  await humanPause();
}

/** Étape 1 : réutilise le locataire enregistré (pré-remplit tout, pièces incluses). */
export async function ensureTenant(
  page: Page,
  recordId: string,
  missionId: ObjectId | null,
): Promise<void> {
  await page.goto(`${IBAIL}/edition/records/${recordId}/tenants`, {
    waitUntil: "domcontentloaded",
  });
  await humanPause();

  // Déjà fait ? (chip « Candidat XX » présent)
  if (await page.getByText(/^candidat /i).first().isVisible().catch(() => false)) {
    await shoot(page, missionId, "etape1_candidat_deja_present");
    return;
  }

  const reuse = page
    .locator("a, button")
    .filter({ hasText: /cliquez ici/i })
    .first();
  if (!(await reuse.isVisible().catch(() => false))) {
    await shoot(page, missionId, "etape1_lien_reutilisation_introuvable");
    throw new InterventionError("étape 1 : lien « locataires déjà enregistrés » introuvable");
  }
  await reuse.click();
  await humanPause();

  // Modal : sélectionner le premier locataire proposé
  const pick = page
    .locator("[role=dialog], .modal, body")
    .locator("a, button, li")
    .filter({ hasText: /candidat|locataire|s[ée]lectionner|choisir|utiliser/i })
    .first();
  if (!(await pick.isVisible().catch(() => false))) {
    await shoot(page, missionId, "etape1_selection_introuvable");
    throw new InterventionError("étape 1 : sélection du locataire enregistré impossible");
  }
  await pick.click();
  await sleep(2000);

  if (!(await page.getByText(/^candidat /i).first().isVisible().catch(() => false))) {
    await shoot(page, missionId, "etape1_candidat_absent_apres_reutilisation");
    throw new InterventionError("étape 1 : le candidat n'apparaît pas après réutilisation");
  }
  await shoot(page, missionId, "etape1_candidat_ok");
}

/** Étape 2 : réutilise les garants enregistrés. Échec → intervention (pas de saisie hasardeuse en v1). */
export async function ensureGuarantors(
  page: Page,
  recordId: string,
  missionId: ObjectId | null,
): Promise<void> {
  await gotoStep(page, recordId, /garant/i);

  if ((await page.getByText(/^garant /i).count().catch(() => 0)) >= 1) {
    await shoot(page, missionId, "etape2_garants_deja_presents");
    return;
  }

  // Lien de réutilisation (href précis observé sur iBail — ouvre une modale Turbo)
  const reuse = page
    .locator('a[href*="record_person_selections/new"][href*="Guarantor"]')
    .first();
  if (!(await reuse.isVisible().catch(() => false))) {
    await shoot(page, missionId, "etape2_lien_reutilisation_introuvable");
    throw new InterventionError("étape 2 : lien de réutilisation garant introuvable");
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const dialog = page.locator("dialog[open]").first();
    if (!(await dialog.isVisible().catch(() => false))) {
      if (!(await reuse.isVisible().catch(() => false))) break;
      await reuse.click();
      await dialog.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      await humanPause();
    }
    await shoot(page, missionId, `etape2_modale_${attempt}`);

    // DIAGNOSTIC calibration : structure exacte de la modale (pour finaliser les sélecteurs)
    const html = (await dialog.innerHTML().catch(() => "")).replace(/\s+/g, " ");
    console.log(`[agent][diag] modale garant #${attempt} (900c): ${html.slice(0, 900)}`);

    // Cas A : <select> de personnes enregistrées → 1re vraie option
    const select = dialog.locator("select").first();
    if (await select.isVisible().catch(() => false)) {
      const values = await select
        .locator("option")
        .evaluateAll((os) =>
          os.map((o) => (o as HTMLOptionElement).value).filter((v) => v && v.trim() !== ""),
        )
        .catch(() => [] as string[]);
      if (values[0]) {
        await select.selectOption(values[0]).catch(() => {});
        await humanPause();
      }
    }

    // Bouton de validation de la modale
    const confirm = dialog
      .locator("button, input[type=submit], a")
      .filter({
        hasText: /ajouter|valider|s[ée]lectionner|choisir|confirmer|enregistrer|utiliser|associer/i,
      })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click().catch(() => {});
      await sleep(2500);
    } else {
      break; // pas de bouton évident → on s'arrête et on remonte le diagnostic
    }

    if ((await page.getByText(/^garant /i).count().catch(() => 0)) >= 1) {
      await shoot(page, missionId, "etape2_garants_ok");
      return;
    }
  }

  await shoot(page, missionId, "etape2_garants_reutilisation_echec");
  throw new InterventionError(
    "étape 2 : réutilisation garant à calibrer — copie-moi la ligne de log « [diag] modale garant » (ou complète les garants sur iBail puis re-GO)",
  );
}

/** Étape 3 : vérifie que chaque catégorie de pièce obligatoire (*) contient au moins un document. */
export async function checkDocuments(
  page: Page,
  recordId: string,
  missionId: ObjectId | null,
): Promise<void> {
  await gotoStep(page, recordId, /pi[èe]ces justificatives/i);
  await shoot(page, missionId, "etape3_pieces");

  const content = await page.locator("body").innerText();
  // Sections « ...* » suivies (ou non) d'un « Document 1 : »
  const blocks = content.split(/\n(?=[A-ZÀ-Ü][^\n]{10,120}\*)/);
  const missing: string[] = [];
  for (const b of blocks) {
    const title = b.split("\n")[0]?.trim();
    if (!title || !title.includes("*")) continue;
    if (!/document\s*1/i.test(b)) missing.push(title.replace(/\s*\*\s*$/, ""));
  }
  if (missing.length > 0) {
    throw new InterventionError(
      `étape 3 : pièces obligatoires manquantes → ${missing.slice(0, 4).join(" · ")}`,
    );
  }
}

function toIsoDate(ddmmyyyy: string): string {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ddmmyyyy;
}

function frDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Calcule la date d'entrée : max(demain, plancher configuré). */
export function computeEntryDate(profile: ApplicationProfile, now = new Date()): string {
  const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
  if (profile.entryDateFloor) {
    const iso = toIsoDate(profile.entryDateFloor);
    const floor = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(floor.getTime()) && floor > tomorrow) return frDate(floor);
  }
  return frDate(tomorrow);
}

/** Remplit un champ date (natif type=date, texte, ou picker flatpickr) et vérifie la valeur. */
async function tryFillDate(input: Locator, ddmmyyyy: string): Promise<boolean> {
  if (!(await input.isVisible().catch(() => false))) return false;
  const type = (await input.getAttribute("type").catch(() => "")) || "text";
  const value = type === "date" ? toIsoDate(ddmmyyyy) : ddmmyyyy;
  await input.fill(value).catch(() => {});
  let cur = await input.inputValue().catch(() => "");
  if (!cur) {
    // pickers qui ignorent fill() → clic + frappe
    await input.click().catch(() => {});
    await input.type(value, { delay: 40 }).catch(() => {});
    await input.press("Escape").catch(() => {});
    cur = await input.inputValue().catch(() => "");
  }
  return cur.length > 0;
}

/** Trouve le champ date par plusieurs stratégies (label[for], proximité). */
async function fillDateSmart(page: Page, labelRe: RegExp, ddmmyyyy: string): Promise<boolean> {
  // 1) association <label for="id"> → #id
  const labels = page.locator("label").filter({ hasText: labelRe });
  if ((await labels.count().catch(() => 0)) > 0) {
    const forId = await labels.first().getAttribute("for").catch(() => null);
    if (forId) {
      if (await tryFillDate(page.locator(`[id="${forId}"]`).first(), ddmmyyyy)) return true;
    }
  }
  // 2) proximité : conteneur portant le libellé
  const cont = page.locator("div, fieldset, label").filter({ hasText: labelRe }).last();
  const near = cont.locator("input").first();
  if (await tryFillDate(near, ddmmyyyy)) return true;
  return false;
}

/**
 * Étape 4 : remplit dates + « comment connu » + coche les attestations.
 * NE SOUMET PAS — la soumission est une action séparée (GO / full-auto).
 */
export async function prepareReservation(
  page: Page,
  recordId: string,
  profile: ApplicationProfile,
  missionId: ObjectId | null,
): Promise<void> {
  await gotoStep(page, recordId, /demande de r[ée]servation/i);
  await shoot(page, missionId, "etape4_avant");

  // DIAGNOSTIC calibration : lister les champs de l'étape 4 (cibler date + select exactement)
  const fields = await page
    .locator("form input, form select, form textarea")
    .evaluateAll((els) =>
      els.map((e) => {
        const el = e as HTMLInputElement;
        return `${el.tagName.toLowerCase()}[type=${el.getAttribute("type") || ""}] name=${el.getAttribute("name") || ""} id=${el.id || ""} ph=${el.getAttribute("placeholder") || ""}`;
      }),
    )
    .catch(() => [] as string[]);
  console.log("[agent][diag] étape4 champs:", JSON.stringify(fields).slice(0, 1400));

  // Champs iBail exacts (relevés en calibration) ; fillDateSmart en filet de sécurité.
  const entry = computeEntryDate(profile);
  const okEntry =
    (await tryFillDate(page.locator("#booking_desired_started_at"), entry)) ||
    (await fillDateSmart(page, /date d'entr[ée]e/i, entry));
  if (!okEntry) {
    await shoot(page, missionId, "etape4_date_entree_echec");
    throw new InterventionError("étape 4 : date d'entrée (booking_desired_started_at) non remplie");
  }
  await humanPause();
  if (profile.defaultExitDate) {
    if (!(await tryFillDate(page.locator("#booking_desired_finished_at"), profile.defaultExitDate))) {
      await fillDateSmart(page, /date de sortie/i, profile.defaultExitDate);
    }
    await humanPause();
  }

  // « Comment avez-vous connu ARPEJ ? » — select requis : on garantit une valeur.
  const knownSelect = page.locator("#booking_how_learned_about_arpej");
  if (await knownSelect.isVisible().catch(() => false)) {
    let chosen = false;
    try {
      await knownSelect.selectOption({ label: profile.howKnown });
      chosen = true;
    } catch {
      /* label absent de la liste */
    }
    if (!chosen) {
      const vals = await knownSelect
        .locator("option")
        .evaluateAll((os) =>
          os.map((o) => (o as HTMLOptionElement).value).filter((v) => v && v.trim() !== ""),
        )
        .catch(() => [] as string[]);
      if (vals[0]) await knownSelect.selectOption(vals[0]).catch(() => {});
      console.warn(`[agent] option « ${profile.howKnown} » introuvable → 1re option choisie`);
    }
    await humanPause();
  }

  // Cocher les attestations (2 cases attendues sur cette étape)
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked().catch(() => true))) {
      await box.check().catch(() => {});
      await sleep(rand(300, 800));
    }
  }

  await shoot(page, missionId, "etape4_prete_avant_soumission");
}

/** Soumet la demande de réservation (action finale, irréversible). */
export async function submitReservation(
  page: Page,
  recordId: string,
  missionId: ObjectId | null,
): Promise<void> {
  await gotoStep(page, recordId, /demande de r[ée]servation/i);

  let submit = page
    .locator('input[type="submit"][name="commit"], button[name="commit"]')
    .first();
  if (!(await submit.isVisible().catch(() => false))) {
    submit = page
      .locator("button, input[type=submit], a")
      .filter({ hasText: /envoyer|valider|soumettre|d[ée]poser ma demande|transmettre/i })
      .last();
  }
  if (!(await submit.isVisible().catch(() => false))) {
    await shoot(page, missionId, "soumission_bouton_introuvable");
    throw new InterventionError("bouton de soumission (commit) introuvable à l'étape 4");
  }
  await shoot(page, missionId, "avant_soumission");
  await submit.click();
  await sleep(2500);

  // Confirmation éventuelle (modal Oui)
  const oui = page.locator("button, a").filter({ hasText: /^oui$/i }).first();
  if (await oui.isVisible().catch(() => false)) {
    await oui.click();
    await sleep(2500);
  }

  const confirmed =
    (await page
      .getByText(/envoy[ée]|transmis|à l'[ée]tude|100\s*%/i)
      .first()
      .isVisible()
      .catch(() => false)) || page.url().includes("/records");
  await shoot(page, missionId, "apres_soumission");
  if (!confirmed) {
    throw new InterventionError("soumission cliquée mais confirmation non détectée — vérifie sur iBail");
  }
}
