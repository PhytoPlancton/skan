/**
 * Preuve de bout en bout (sans notification réelle) :
 *  1. interroge l'API ARPEJ live
 *  2. affiche l'état d'Eole (attendu : absente = 0) et de Camille Sée (attendu : >= 1)
 *  3. rejoue la logique de détection : un 1er passage doit alerter sur les
 *     résidences déjà dispo, un 2e passage (état mis à jour) ne doit plus alerter.
 *
 * Lancer : npm run verify
 */
import { fetchAllResidences } from "../src/lib/arpej.ts";
import { computeAlerts, type WatchRecord } from "../src/lib/checker.ts";

const EOLE = "etudiante-eole-paris";
const CAMILLE = "camille-see-residence-etudiante-saint-denis";

async function main() {
  const residences = await fetchAllResidences();
  const bySlug = new Map(residences.map((r) => [r.slug, r]));

  console.log(`\n=== ARPEJ live : ${residences.length} résidences réservables ===`);

  const eole = bySlug.get(EOLE);
  const camille = bySlug.get(CAMILLE);

  console.log(
    `\nEole (${EOLE}) :`,
    eole
      ? `${eole.availableRooms} logement(s) dispo`
      : "ABSENTE de l'API => Aucun logement disponible ✅ (comportement attendu)",
  );
  console.log(
    `Camille Sée (${CAMILLE}) :`,
    camille ? `${camille.availableRooms} logement(s) dispo` : "absente",
  );

  // On surveille les deux, baseline = indisponible.
  const watches: WatchRecord[] = [
    { slug: EOLE, title: "Eole", link: "", lastAvailable: false, lastAvailableRooms: 0 },
    { slug: CAMILLE, title: "Camille Sée", link: "", lastAvailable: false, lastAvailableRooms: 0 },
  ];

  const pass1 = computeAlerts(watches, residences);
  console.log(`\n--- Passage 1 (baseline indisponible) : ${pass1.alerts.length} alerte(s) ---`);
  for (const a of pass1.alerts) {
    console.log(`  🔔 ${a.title} — ${a.availableRooms} logement(s) — ${a.link}`);
  }

  // Passage 2 : on repart de l'état mis à jour (anti-spam attendu => 0 alerte).
  const pass2 = computeAlerts(pass1.updates, residences);
  console.log(`--- Passage 2 (état persisté) : ${pass2.alerts.length} alerte(s) (anti-spam) ---`);

  const ok =
    !eole && // Eole absente
    (camille ? pass1.alerts.some((a) => a.slug === CAMILLE) : true) &&
    pass2.alerts.length === 0;
  console.log(`\nRésultat global : ${ok ? "✅ OK" : "⚠️  à vérifier"}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Échec verify-detection:", err);
  process.exitCode = 1;
});
