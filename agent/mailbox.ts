/**
 * Récupération du magic link iBail dans la boîte mail (IMAP + app password).
 * Filtre strict : mails d'ARPEJ/iBail **postérieurs à la demande** uniquement
 * (l'IMAP SINCE est à la journée près → on revérifie la date exacte pour ne
 * jamais rejouer un ancien lien déjà expiré). Poll jusqu'à réception.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const LINK_RE = /https:\/\/ibail\.arpej\.fr\/session\?t=[^\s"'<>)\]]+/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchOnce(notBefore: Date): Promise<string | null> {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_IMAP_USER / GMAIL_IMAP_APP_PASSWORD manquants");
  }
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    // SINCE est date-only → filtre grossier ; la date exacte est revérifiée plus bas.
    const uidLists = await Promise.all([
      client.search({ since: notBefore, from: "arpej" }, { uid: true }),
      client.search({ since: notBefore, from: "ibail" }, { uid: true }),
    ]);
    const uids = [...new Set(uidLists.flatMap((l) => (Array.isArray(l) ? l : [])))].sort(
      (a, b) => b - a, // plus récents d'abord
    );
    for (const uid of uids.slice(0, 8)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !("source" in msg) || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      // Ignore tout mail antérieur à la demande (ancien lien = expiré).
      if (parsed.date && parsed.date.getTime() < notBefore.getTime()) continue;
      const haystack = `${parsed.html || ""}\n${parsed.text || ""}`;
      const m = haystack.match(LINK_RE);
      if (m) return m[0];
    }
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Attend le mail « Connexion à iBail » postérieur à `requestedAt` et renvoie
 * l'URL de session. Renvoie null si rien n'arrive dans le délai.
 */
export async function fetchMagicLink(
  requestedAt: Date,
  timeoutMs = 180_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await searchOnce(requestedAt).catch((e) => {
      console.error("[mailbox]", (e as Error).message);
      return null;
    });
    if (link) return link;
    await sleep(8_000);
  }
  return null;
}
