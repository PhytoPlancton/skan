/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Le poller (node-cron) est démarré dans instrumentation.ts au boot serveur.
  serverExternalPackages: ["mongodb", "node-cron"],
};

export default nextConfig;
