import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeNotBefore,
  decideApplication,
  type ApplyCounters,
} from "../src/lib/apply-matching.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../src/lib/settings.ts";
import { parisMinutesOfDay, timeToMinutes } from "../src/lib/dates.ts";
import type { AlertEvent } from "../src/lib/checker.ts";

const alert: AlertEvent = {
  slug: "etudiante-eole-paris",
  title: "Eole",
  link: "https://www.arpej.fr/fr/residence/etudiante-eole-paris/",
  availableRooms: 1,
};

const zero: ApplyCounters = { today: 0, week: 0, active: 0 };

function settings(patch: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    agentEnabled: true,
    testMode: false,
    strategies: { [alert.slug]: { mode: "love" } },
    ...patch,
  };
}

test("agent coupé → skip", () => {
  const d = decideApplication(settings({ agentEnabled: false }), alert, 500, zero);
  assert.equal(d.action, "skip");
});

test("pause active → skip", () => {
  const d = decideApplication(
    settings({ pausedUntil: new Date(Date.now() + 3_600_000).toISOString() }),
    alert,
    500,
    zero,
  );
  assert.equal(d.action, "skip");
});

test("mode manuel → skip", () => {
  const d = decideApplication(settings({ mode: "manual" }), alert, 500, zero);
  assert.equal(d.action, "skip");
});

test("résidence non armée → skip", () => {
  const d = decideApplication(settings({ strategies: {} }), alert, 500, zero);
  assert.equal(d.action, "skip");
});

test("coup de cœur → apply quel que soit le prix", () => {
  const d = decideApplication(settings({}), alert, 9999, zero);
  assert.equal(d.action, "apply");
});

test("critères : loyer sous le max → apply", () => {
  const s = settings({ strategies: { [alert.slug]: { mode: "criteria", maxRent: 600 } } });
  assert.equal(decideApplication(s, alert, 550, zero).action, "apply");
});

test("critères : loyer au-dessus → skip motivé", () => {
  const s = settings({ strategies: { [alert.slug]: { mode: "criteria", maxRent: 600 } } });
  const d = decideApplication(s, alert, 620, zero);
  assert.equal(d.action, "skip");
  assert.match((d as { reason: string }).reason, /620/);
});

test("critères : prix inconnu → skip prudent", () => {
  const s = settings({ strategies: { [alert.slug]: { mode: "criteria", maxRent: 600 } } });
  assert.equal(decideApplication(s, alert, null, zero).action, "skip");
});

test("plafond jour / semaine / actifs → skip", () => {
  assert.equal(
    decideApplication(settings({}), alert, 500, { ...zero, today: 1 }).action,
    "skip",
  );
  assert.equal(
    decideApplication(settings({}), alert, 500, { ...zero, week: 3 }).action,
    "skip",
  );
  assert.equal(
    decideApplication(settings({}), alert, 500, { ...zero, active: 2 }).action,
    "skip",
  );
});

test("mode à blanc → apply avec dryRun", () => {
  const d = decideApplication(settings({ testMode: true }), alert, 500, zero);
  assert.equal(d.action, "apply");
  assert.equal((d as { dryRun: boolean }).dryRun, true);
});

test("mode auto (débloqué) → mission auto", () => {
  const d = decideApplication(
    settings({ mode: "auto", hybridSuccessCount: 2 }),
    alert,
    500,
    zero,
  );
  assert.equal(d.action, "apply");
  assert.equal((d as { mode: string }).mode, "auto");
});

test("notBefore : respecte délai minimum et fenêtre horaire Paris", () => {
  const s = settings({});
  const now = new Date();
  const nb = computeNotBefore(s, now, () => 0); // rand=0 → délai = delayMinMin
  assert.ok(nb.getTime() >= now.getTime() + s.delayMinMin * 60_000 - 1000);
  const min = parisMinutesOfDay(nb);
  const start = timeToMinutes(s.actionWindowStart);
  const end = timeToMinutes(s.actionWindowEnd);
  assert.ok(
    min >= start && min <= end + s.delayMinMin,
    `notBefore ${min} hors fenêtre [${start}, ${end}]`,
  );
});
