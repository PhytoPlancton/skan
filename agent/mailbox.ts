/**
 * Récupération du magic link iBail dans la boîte mail (IMAP + app password).
 * Filtre strict : mails récents provenant d'ARPEJ/iBail uniquement, on n'y lit
 * rien d'autre. Poll jusqu'à réception (les liens expirent ~15 min).
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const LINK_RE = /https:\/\/ibail\.arpej\.fr\/session\?t=[^\s"'<>)\]]+/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchOnce(since: Date): Promise<string | null> {
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
    const uidLists = await Promise.all([
      client.search({ since, from: "arpej" }, { uid: true }),
      client.search({ since, from: "ibail" }, { uid: true }),
    ]);
    const uids = [...new Set(uidLists.flatMap((l) => (Array.isArray(l) ? l : [])))].sort(
      (a, b) => b - a, // plus récents d'abord
    );
    for (const uid of uids.slice(0, 5)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !("source" in msg) || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
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
 * Attend le mail « Connexion à iBail » et renvoie l'URL de session.
 * @param since ne considère que les mails reçus après cet instant
 */
export async function fetchMagicLink(
  since: Date,
  timeoutMs = 180_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await searchOnce(since).catch((e) => {
      console.error("[mailbox]", (e as Error).message);
      return null;
    });
    if (link) return link;
    await sleep(10_000);
  }
  return null;
}
