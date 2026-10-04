/**
 * Client HTTP de l'API skan pour l'agent.
 * L'agent n'a NI accès à MongoDB NI la clé du coffre : il parle au serveur avec
 * son jeton personnel (Settings → « Mon agent »), et le serveur ne lui donne
 * accès qu'aux données de SON propriétaire.
 *
 * Env : SKAN_URL (ex. https://skan.nmt.ovh) + AGENT_TOKEN (skan_…).
 */

export interface AgentMission {
  _id: string;
  userId: string;
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  status: string;
  mode: "hybrid" | "auto";
  ibailRecordId?: string;
}

/** Jeton refusé (révoqué / régénéré) : inutile d'insister. */
export class AgentAuthError extends Error {}

function config(): { base: string; token: string } {
  const base = (process.env.SKAN_URL || process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const token = (process.env.AGENT_TOKEN || "").trim();
  if (!base) throw new AgentAuthError("SKAN_URL manquant dans .env (ex. https://skan.nmt.ovh)");
  if (!token) {
    throw new AgentAuthError("AGENT_TOKEN manquant dans .env (à générer dans skan → Settings → Mon agent)");
  }
  return { base, token };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { base, token } = config();
  const res = await fetch(`${base}/api/agent${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new AgentAuthError(json.error || "jeton d'agent refusé");
  if (!res.ok) throw new Error(`API skan ${method} ${path} → ${res.status} ${json.error ?? ""}`.trim());
  return json;
}

export const api = {
  me: () => call<{ user: string; agentEnabled: boolean; pausedUntil: string | null }>("GET", "/me"),

  claim: async (): Promise<AgentMission | null> =>
    (await call<{ mission: AgentMission | null }>("POST", "/claim")).mission,

  event: (id: string, event: string, detail?: string, ibailRecordId?: string) =>
    call("POST", `/missions/${id}`, { action: "event", event, detail, ibailRecordId }),

  status: (id: string, status: string, reason?: string, event?: string, detail?: string) =>
    call("POST", `/missions/${id}`, { action: "status", status, reason, event, detail }),

  ready: (id: string) => call("POST", `/missions/${id}`, { action: "ready" }),

  submitted: (id: string, how: string) => call("POST", `/missions/${id}`, { action: "submitted", how }),

  notify: (text: string, subject: string, link?: string) =>
    call("POST", "/notify", { text, subject, link }),

  getVault: async <T>(section: string): Promise<T | null> =>
    (await call<{ value: T | null }>("GET", `/vault/${section}`)).value,

  putVault: (section: string, value: unknown) => call("PUT", `/vault/${section}`, { value }),

  screenshot: (missionId: string | null, step: string, png: Buffer) =>
    call("POST", "/screenshots", { missionId, step, png: png.toString("base64") }),
};
