/**
 * Hook Next.js exécuté une fois au démarrage du serveur.
 * On y lance le poller uniquement dans le runtime Node (pas Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("./lib/poller");
    startPoller();
  }
}
