/**
 * Connexion MongoDB — client singleton réutilisé par tout le process
 * (routes API + poller partagent le même pool).
 *
 * Contraintes respectées :
 *  - maxPoolSize bas (limite de 500 connexions partagées entre apps)
 *  - fermeture propre sur SIGTERM/SIGINT
 *  - cache global pour ne pas multiplier les clients en dev (HMR)
 */
import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "skan";

const globalForMongo = globalThis as unknown as {
  _skanMongoClient?: Promise<MongoClient>;
  _skanMongoHooked?: boolean;
};

function createClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI manquant dans l'environnement");

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
  });

  if (!globalForMongo._skanMongoHooked) {
    globalForMongo._skanMongoHooked = true;
    const close = async () => {
      try {
        const c = await globalForMongo._skanMongoClient;
        await c?.close();
      } catch {
        /* noop */
      } finally {
        process.exit(0);
      }
    };
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  }

  return client.connect();
}

export async function getDb(): Promise<Db> {
  if (!globalForMongo._skanMongoClient) {
    globalForMongo._skanMongoClient = createClientPromise();
  }
  const client = await globalForMongo._skanMongoClient;
  return client.db(dbName);
}
