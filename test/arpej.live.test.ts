import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchAllResidences, slugFromLink } from "../src/lib/arpej.ts";

test("slugFromLink extrait le slug du lien ARPEJ", () => {
  assert.equal(
    slugFromLink("https://www.arpej.fr/fr/residence/etudiante-eole-paris/"),
    "etudiante-eole-paris",
  );
  assert.equal(
    slugFromLink(
      "https://www.arpej.fr/fr/residence/camille-see-residence-etudiante-saint-denis/",
    ),
    "camille-see-residence-etudiante-saint-denis",
  );
});

// Smoke test réseau : dépend de l'API ARPEJ en ligne.
test("fetchAllResidences renvoie des résidences bien formées", async () => {
  const residences = await fetchAllResidences();

  assert.ok(residences.length >= 10, `attendu >= 10 résidences, reçu ${residences.length}`);

  for (const r of residences) {
    assert.equal(typeof r.slug, "string");
    assert.ok(r.slug.length > 0);
    assert.equal(typeof r.title, "string");
    assert.ok(r.link.startsWith("https://www.arpej.fr/"));
    // l'API ne liste que des résidences réservables
    assert.ok(r.availableRooms >= 1, `${r.slug} devrait avoir >= 1 logement`);
  }

  // pas de slugs en double
  const slugs = new Set(residences.map((r) => r.slug));
  assert.equal(slugs.size, residences.length, "slugs non uniques");
});
