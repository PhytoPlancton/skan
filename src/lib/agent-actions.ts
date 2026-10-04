/**
 * Transitions de mission déclenchées par l'agent (via /api/agent/*).
 * Côté serveur : génération du lien GO, notifications, compteurs — l'agent
 * n'a jamais accès à la base ni aux tokens EDJ Labs.
 */
import { randomBytes } from "node:crypto";
import { updateMission, type MissionDoc, type MissionStatus } from "./missions";
import { notifyText } from "./notifier";
import { incrementHybridSuccess } from "./settings";
import type { UserDoc } from "./users";

/** URL publique de l'app : PUBLIC_APP_URL, sinon déduite de la requête (derrière Traefik). */
export function publicUrl(req?: Request): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    if (host) return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }
  return "http://localhost:3000";
}

/** Dossier prêt (hybride) : lien GO signé 24 h + notification. */
export async function markReady(user: UserDoc, m: MissionDoc, baseUrl: string): Promise<void> {
  const token = randomBytes(24).toString("hex");
  const exp = new Date(Date.now() + 24 * 3_600_000);
  await updateMission(
    user._id,
    m._id!,
    { status: "awaiting_go", goToken: token, goTokenExp: exp },
    "awaiting_go",
  );
  const go = `${baseUrl}/go/${token}`;
  await notifyText(
    user,
    `🤖 skan — dossier PRÊT pour ${m.title} (${m.availableRooms} dispo). Tout est rempli, rien n'est envoyé. GO (24 h) : ${go}`,
    `skan — GO ? ${m.title}`,
    go,
  );
}

/** Dossier soumis : statut, rappel garants H+4, compteur hybride, notification. */
export async function markSubmitted(user: UserDoc, m: MissionDoc, how: string): Promise<void> {
  await updateMission(
    user._id,
    m._id!,
    {
      status: "submitted",
      submittedAt: new Date(),
      remindGuarantorsAt: new Date(Date.now() + 4 * 3_600_000),
    },
    "submitted",
    how,
  );
  if (m.mode === "hybrid") await incrementHybridSuccess(user._id);
  await notifyText(
    user,
    `✅ skan — dossier SOUMIS pour ${m.title} (${how}). 📩 Important : tes garants doivent cliquer le lien de validation reçu par email — préviens-les maintenant.`,
    `skan — dossier soumis : ${m.title}`,
  );
}

/** Statuts que l'agent peut poser lui-même (le reste passe par ready/submitted). */
export const AGENT_SETTABLE: MissionStatus[] = [
  "submitting",
  "skipped",
  "failed",
  "intervention",
  "expired",
];
