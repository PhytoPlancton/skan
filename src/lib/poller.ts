/**
 * Poller interne : déclenche runCheck() à intervalle régulier via node-cron.
 * Démarré une seule fois au boot serveur (cf. src/instrumentation.ts).
 * Déploiement attendu : 1 seule replica (sinon checks dupliqués).
 */
import cron from "node-cron";
import { runCheck } from "./check-run";

const globalForPoller = globalThis as unknown as { _skanPollerStarted?: boolean };

export function startPoller(): void {
  if (globalForPoller._skanPollerStarted) return;
  globalForPoller._skanPollerStarted = true;

  const minutes = Math.min(59, Math.max(1, Number(process.env.POLL_INTERVAL_MIN || 5)));
  const expr = `*/${minutes} * * * *`;

  if (!cron.validate(expr)) {
    console.error(`[poller] expression cron invalide: ${expr}`);
    return;
  }

  console.log(`[poller] démarrage — vérification toutes les ${minutes} min`);
  cron.schedule(expr, () => {
    runCheck().catch((e) => console.error("[poller] erreur:", e));
  });

  // Premier passage peu après le démarrage (laisse le serveur s'initialiser).
  setTimeout(() => {
    runCheck().catch((e) => console.error("[poller] erreur (initial):", e));
  }, 10_000);
}
