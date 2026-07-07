/**
 * Notification multi-canal via les API EDJ Labs (SMS / WhatsApp / Email).
 *
 * - Tokens lus dans l'environnement (jamais en dur).
 * - Les canaux sont envoyés en parallèle : l'échec d'un canal n'empêche pas
 *   les autres (ex. WhatsApp renvoie actuellement 500 côté gateway EDJ Labs).
 * - NOTIFY_DRY_RUN=1 => aucun envoi réel, on logge seulement (tests locaux).
 *
 * Endpoints connus :
 *   SMS      POST {BASE}/messages/send   body { address, text, subject }
 *   WhatsApp POST {BASE}/wa/send         body { address, text }
 *   Email    POST {EDJ_EMAIL_ENDPOINT}   body { recipients, subject, html }  (défaut /email/send)
 */
import type { AlertEvent } from "./checker";

export type Channel = "sms" | "whatsapp" | "email";

function enabledChannels(): Channel[] {
  return (process.env.ENABLED_CHANNELS || "sms,whatsapp,email")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Channel => s === "sms" || s === "whatsapp" || s === "email");
}

export function buildMessage(a: AlertEvent): string {
  const n = a.availableRooms;
  return `🏠 ARPEJ — ${a.title} : ${n} logement${n > 1 ? "s" : ""} disponible${
    n > 1 ? "s" : ""
  } ! Réserve vite : ${a.link}`;
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${detail}`.slice(0, 200));
  }
}

/** Envoie l'alerte « place disponible » sur tous les canaux actifs. */
export async function notify(a: AlertEvent): Promise<Record<Channel, boolean>> {
  return notifyText(buildMessage(a), `ARPEJ — ${a.title} : logement disponible`, a.link);
}

/**
 * Envoie un message libre (missions, GO, interventions…) sur les canaux actifs.
 * Renvoie le succès par canal.
 */
export async function notifyText(
  text: string,
  subject: string,
  linkForHtml?: string,
): Promise<Record<Channel, boolean>> {
  const base = process.env.EDJ_API_BASE || "https://api.edj-labs.com";
  const phone = process.env.NOTIFY_PHONE;
  const email = process.env.NOTIFY_EMAIL;
  const channels = enabledChannels();

  if (process.env.NOTIFY_DRY_RUN === "1") {
    console.log(`[notify][DRY_RUN] (${channels.join(", ")}) ${text}`);
    return Object.fromEntries(channels.map((c) => [c, true])) as Record<Channel, boolean>;
  }

  const jobs: Array<{ channel: Channel; run: Promise<void> }> = [];

  if (channels.includes("sms") && phone && process.env.EDJ_SMS_TOKEN) {
    jobs.push({
      channel: "sms",
      run: postJson(`${base}/messages/send`, process.env.EDJ_SMS_TOKEN, {
        address: phone,
        text,
        subject: "",
      }),
    });
  }

  if (channels.includes("whatsapp") && phone && process.env.EDJ_WA_TOKEN) {
    jobs.push({
      channel: "whatsapp",
      run: postJson(`${base}/wa/send`, process.env.EDJ_WA_TOKEN, {
        address: phone,
        text,
      }),
    });
  }

  if (channels.includes("email") && email && process.env.EDJ_EMAIL_TOKEN) {
    const endpoint = process.env.EDJ_EMAIL_ENDPOINT || `${base}/email/send`;
    const html = `<p>${
      linkForHtml
        ? text.replace(linkForHtml, `<a href="${linkForHtml}">${linkForHtml}</a>`)
        : text
    }</p>`;
    jobs.push({
      channel: "email",
      run: postJson(endpoint, process.env.EDJ_EMAIL_TOKEN, {
        recipients: [email],
        subject,
        html,
      }),
    });
  }

  const results = Object.fromEntries(channels.map((c) => [c, false])) as Record<
    Channel,
    boolean
  >;

  const settled = await Promise.allSettled(jobs.map((j) => j.run));
  settled.forEach((s, i) => {
    const { channel } = jobs[i];
    if (s.status === "fulfilled") {
      results[channel] = true;
    } else {
      console.error(`[notify] ${channel} échec:`, (s.reason as Error)?.message ?? s.reason);
    }
  });

  return results;
}
