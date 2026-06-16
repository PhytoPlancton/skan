import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAlerts, type WatchRecord } from "../src/lib/checker.ts";
import type { Residence } from "../src/lib/arpej.ts";

function residence(slug: string, availableRooms: number): Residence {
  return {
    id: 1,
    slug,
    title: `Résidence ${slug}`,
    link: `https://www.arpej.fr/fr/residence/${slug}/`,
    city: "Paris",
    zipCode: "75019",
    priceFrom: 500,
    availableRooms,
    isBookable: availableRooms > 0,
    image: null,
  };
}

function watch(slug: string, lastAvailable: boolean): WatchRecord {
  return {
    slug,
    title: `Résidence ${slug}`,
    link: `https://www.arpej.fr/fr/residence/${slug}/`,
    lastAvailable,
    lastAvailableRooms: lastAvailable ? 1 : 0,
  };
}

test("alerte sur transition indisponible -> disponible", () => {
  const watches = [watch("eole", false)];
  const live = [residence("eole", 2)];
  const { alerts, updates } = computeAlerts(watches, live);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].slug, "eole");
  assert.equal(alerts[0].availableRooms, 2);
  assert.equal(updates[0].lastAvailable, true);
  assert.equal(updates[0].lastAvailableRooms, 2);
});

test("pas d'alerte si déjà disponible (anti-spam)", () => {
  const watches = [watch("eole", true)];
  const live = [residence("eole", 3)];
  const { alerts, updates } = computeAlerts(watches, live);

  assert.equal(alerts.length, 0);
  assert.equal(updates[0].lastAvailable, true);
  assert.equal(updates[0].lastAvailableRooms, 3);
});

test("pas d'alerte si toujours indisponible (slug absent de l'API)", () => {
  const watches = [watch("eole", false)];
  const live: Residence[] = []; // eole absente => 0 dispo
  const { alerts, updates } = computeAlerts(watches, live);

  assert.equal(alerts.length, 0);
  assert.equal(updates[0].lastAvailable, false);
  assert.equal(updates[0].lastAvailableRooms, 0);
});

test("réarmement : disponible -> indisponible sans alerte", () => {
  const watches = [watch("eole", true)];
  const live: Residence[] = []; // la place est repartie
  const { alerts, updates } = computeAlerts(watches, live);

  assert.equal(alerts.length, 0);
  assert.equal(updates[0].lastAvailable, false);
  assert.equal(updates[0].lastAvailableRooms, 0);
});

test("statut fallback pour un slug absent (lien reconstruit, 0 dispo)", () => {
  const watches = [watch("etudiante-eole-paris", false)];
  const { statuses } = computeAlerts(watches, []);

  assert.equal(statuses[0].available, false);
  assert.equal(statuses[0].availableRooms, 0);
  assert.equal(
    statuses[0].link,
    "https://www.arpej.fr/fr/residence/etudiante-eole-paris/",
  );
});

test("plusieurs surveillances, états mixtes", () => {
  const watches = [
    watch("a", false), // devient dispo -> alerte
    watch("b", true), // déjà dispo -> rien
    watch("c", false), // absente -> rien
  ];
  const live = [residence("a", 1), residence("b", 5)];
  const { alerts } = computeAlerts(watches, live);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].slug, "a");
});
