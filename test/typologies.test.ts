import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  describeFilters,
  describeOffer,
  findIbailCode,
  matchingOffers,
  mergeByType,
  normalizeFilters,
  parseOffers,
  parseRange,
  parseReservationPage,
  typeKey,
} from "../src/lib/typologies.ts";

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("code iBail trouvé dans la page arpej.fr (lien « Je dépose mon dossier »)", () => {
  assert.equal(findIbailCode(fx("arpej-residence-vivaldi.html")), "VQ");
  assert.equal(findIbailCode('<a href="https://ibail.arpej.fr/session/new">x</a>'), null);
});

test("page de réservation iBail : id numérique + mois proposés (dédoublonnés)", () => {
  const r = parseReservationPage(fx("ibail-reservation-vq.html"));
  assert.equal(r.residenceId, "94");
  assert.deepEqual(r.months, [
    { month: 10, year: 2026 },
    { month: 11, year: 2026 },
  ]);
  assert.deepEqual(parseReservationPage("<html>rien</html>"), { residenceId: null, months: [] });
});

test("page offers iBail : une entrée par type avec places, surface, loyer", () => {
  const offers = parseOffers(fx("ibail-offers-vq.html"), "2026-10");
  assert.equal(offers.length, 2);
  const [comfort, sweet] = offers;
  assert.equal(comfort.name, "Comfort Studio");
  assert.equal(comfort.key, "comfort studio");
  assert.equal(comfort.available, 1);
  assert.equal(comfort.surfaceMin, 29.2);
  assert.equal(comfort.surfaceMax, 38.4);
  assert.equal(comfort.rentMin, 601.78);
  assert.equal(comfort.rentMax, 703.53);
  assert.equal(comfort.availabilityId, "14869");
  assert.match(comfort.description, /lit double/);
  assert.equal(sweet.name, "Sweet Studio");
  assert.equal(sweet.available, 2);
  assert.equal(sweet.surfaceMin, 19);
  assert.equal(sweet.surfaceMax, 19);
  assert.equal(sweet.rentMin, 479.89);
});

test("bornes : intervalles, valeur seule, exposant m²", () => {
  assert.deepEqual(parseRange("De 29,2 à 38,4 m<sup>2</sup>"), [29.2, 38.4]);
  assert.deepEqual(parseRange("19,0 m<sup>2</sup>"), [19, 19]);
  assert.deepEqual(parseRange("De 1 234,50 € à 1 300,00 €"), [1234.5, 1300]);
  assert.deepEqual(parseRange("—"), [null, null]);
});

test("filtres : type, surface min, loyer max (cas Vivaldi : Comfort oui, 19 m² non)", () => {
  const offers = parseOffers(fx("ibail-offers-vq.html"), "2026-10");
  const names = (f: Parameters<typeof matchingOffers>[1]) => matchingOffers(offers, f).map((o) => o.name);
  assert.deepEqual(names({ types: [], minSurface: null, maxRent: null }), ["Comfort Studio", "Sweet Studio"]);
  assert.deepEqual(names({ types: ["comfort studio"], minSurface: null, maxRent: null }), ["Comfort Studio"]);
  assert.deepEqual(names({ types: [], minSurface: 25, maxRent: null }), ["Comfort Studio"]);
  assert.deepEqual(names({ types: [], minSurface: null, maxRent: 500 }), ["Sweet Studio"]);
  assert.deepEqual(names({ types: ["comfort studio"], minSurface: null, maxRent: 550 }), []);
  // type à 0 place : jamais une correspondance
  assert.deepEqual(matchingOffers([{ ...offers[0], available: 0 }], { types: [], minSurface: null, maxRent: null }), []);
});

test("normalisation des filtres + libellés", () => {
  assert.deepEqual(normalizeFilters({ types: ["Comfort Studio", "comfort  studio"], minSurface: "25", maxRent: "" }), {
    types: ["comfort studio"],
    minSurface: 25,
    maxRent: null,
  });
  assert.equal(normalizeFilters({ types: [], minSurface: -3 }), null);
  assert.equal(normalizeFilters("x"), null);
  assert.equal(typeKey("Studio* Duplex é"), "studio duplex e");
  const offers = parseOffers(fx("ibail-offers-vq.html"), "2026-10");
  assert.equal(describeOffer(offers[0]), "1 Comfort Studio (29–38 m², 602–704 €)");
  assert.equal(
    describeFilters({ types: ["comfort studio"], minSurface: 25, maxRent: 650 }, new Map([["comfort studio", "Comfort Studio"]])),
    "Comfort Studio · ≥ 25 m² · ≤ 650 €",
  );
  assert.equal(describeFilters({ types: [], minSurface: null, maxRent: null }), "Tous les logements");
});

test("plusieurs mois : fusion par type (places additionnées, bornes élargies)", () => {
  const oct = parseOffers(fx("ibail-offers-vq.html"), "2026-10");
  const nov = parseOffers(fx("ibail-offers-vq.html"), "2026-11").map((o) => ({ ...o, rentMax: 800 }));
  const merged = mergeByType([...oct, ...nov]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].available, 2);
  assert.equal(merged[0].rentMax, 800);
  assert.equal(merged[0].month, "2026-10");
});

import { computeFilteredAlerts } from "../src/lib/checker.ts";

test("alertes filtrées : le 19 m² ne déclenche rien, le Comfort qui s'ouvre ensuite oui", () => {
  const all = parseOffers(fx("ibail-offers-vq.html"), "2026-10");
  const sweetOnly = all.map((o) => (o.key === "comfort studio" ? { ...o, available: 0 } : o));
  const res = [{ id: 1, slug: "vivaldi", title: "Vivaldi", link: "L", city: "", zipCode: "", priceFrom: null, availableRooms: 2, isBookable: true, image: null }];
  const watch = { slug: "vivaldi", title: "Vivaldi", link: "L", lastAvailable: false, lastAvailableRooms: 0, filters: { types: ["comfort studio"], minSurface: null, maxRent: null } };
  const url = "https://ibail.arpej.fr/residences/VQ/reservation-d-un-logement";

  // 1) seul le Sweet Studio (19 m²) est libre → pas d'alerte, baseline « pas de correspondance »
  let r = computeFilteredAlerts([watch], res, new Map([["vivaldi", { url, offers: sweetOnly }]]));
  assert.equal(r.alerts.length, 0);
  assert.equal(r.updates[0].lastAvailable, false);

  // 2) un Comfort Studio s'ouvre (la résidence était déjà « dispo ») → alerte avec le détail + lien iBail
  r = computeFilteredAlerts([{ ...watch, lastAvailable: false }], res, new Map([["vivaldi", { url, offers: all }]]));
  assert.equal(r.alerts.length, 1);
  assert.deepEqual(r.alerts[0].offers?.map((o) => o.name), ["Comfort Studio"]);
  assert.equal(r.alerts[0].bookingUrl, url);
  assert.equal(r.updates[0].lastAvailable, true);

  // 3) toujours dispo → pas de re-notification
  r = computeFilteredAlerts([{ ...watch, lastAvailable: true }], res, new Map([["vivaldi", { url, offers: all }]]));
  assert.equal(r.alerts.length, 0);

  // 4) iBail illisible → alerte par prudence, marquée non vérifiée
  r = computeFilteredAlerts([watch], res, new Map([["vivaldi", null]]));
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].unverified, true);

  // 5) sans filtre : comportement historique, enrichi du détail des types
  r = computeFilteredAlerts([{ ...watch, filters: null }], res, new Map([["vivaldi", { url, offers: all }]]));
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].offers?.length, 2);

  // 6) résidence complète → rien, baseline remise à faux
  r = computeFilteredAlerts([{ ...watch, lastAvailable: true }], [], new Map());
  assert.equal(r.alerts.length, 0);
  assert.equal(r.updates[0].lastAvailable, false);
});

import { effectiveFilters } from "../src/lib/typologies.ts";

test("minimum du compte appliqué partout, sauf réglage propre à la résidence", () => {
  assert.deepEqual(effectiveFilters(null, 25), { types: [], minSurface: 25, maxRent: null });
  assert.equal(effectiveFilters(null, null), null);
  // la résidence a son propre minimum
  assert.equal(effectiveFilters({ types: [], minSurface: 30, maxRent: null }, 25)?.minSurface, 30);
  // « peu importe » pour cette résidence malgré le minimum du compte
  assert.equal(effectiveFilters({ types: [], minSurface: 0, maxRent: null }, 25), null);
  // types / loyer conservés, minimum hérité du compte
  assert.deepEqual(effectiveFilters({ types: ["comfort studio"], minSurface: null, maxRent: 700 }, 20), {
    types: ["comfort studio"],
    minSurface: 20,
    maxRent: 700,
  });
  assert.deepEqual(normalizeFilters({ types: [], minSurface: 0 }), { types: [], minSurface: 0, maxRent: null });
});
