/**
 * Récupération du magic link iBail dans la boîte mail (IMAP + app password).
 * Filtre strict : mails d'ARPEJ/iBail **postérieurs à la demande** uniquement
 * (l'IMAP SINCE est à la journée près → on revérifie la date exacte pour ne
 * jamais rejouer un ancien lien déjà expiré). Poll jusqu'à réception.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const LINK_RE = /https:\/\/ibail\.arpej\.fr\/session\?t=[^\s"'<>)\]]+/;

/** App password Gmail refusé/supprimé → inutile de boucler, on remonte tout de suite. */
export class MailboxAuthError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeAuthError(e: unknown): boolean {
  const err = e as { authenticationFailed?: boolean; responseText?: string; message?: string };
  if (err?.authenticationFailed) return true;
  const txt = `${err?.responseText ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return /auth|credential|invalid login|username and password|application-specific/.test(txt);
}

async function searchOnce(notBefore: Date): Promise<string | null> {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_APP_PASSWORD;
  if (!user || !pass) {
    throw new MailboxAuthError("GMAIL_IMAP_USER / GMAIL_IMAP_APP_PASSWORD manquants dans .env");
  }
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
  } catch (e) {
    if (looksLikeAuthError(e)) {
      throw new MailboxAuthError(
        `IMAP Gmail refusé — app password invalide ou supprimé ? (${(e as Error).message})`,
      );
    }
    throw e;
  }

  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const uidLists = await Promise.all([
      client.search({ since: notBefore, from: "arpej" }, { uid: true }),
      client.search({ since: notBefore, from: "ibail" }, { uid: true }),
    ]);
    const uids = [...new Set(uidLists.flatMap((l) => (Array.isArray(l) ? l : [])))].sort(
      (a, b) => b - a,
    );
    console.log(`[mailbox] IMAP OK — ${uids.length} mail(s) iBail candidat(s) depuis ${notBefore.toISOString()}`);
    for (const uid of uids.slice(0, 8)) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !("source" in msg) || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      if (parsed.date && parsed.date.getTime() < notBefore.getTime()) continue;
      const haystack = `${parsed.html || ""}\n${parsed.text || ""}`;
      const m = haystack.match(LINK_RE);
      if (m) {
        console.log(`[mailbox] lien trouvé (mail du ${parsed.date?.toISOString() ?? "?"})`);
        return m[0];
      }
    }
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Attend le mail « Connexion à iBail » postérieur à `requestedAt` et renvoie
 * l'URL de session. @throws MailboxAuthError si l'app password est refusé.
 */
export async function fetchMagicLink(
  requestedAt: Date,
  timeoutMs = 180_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  while (Date.now() < deadline) {
    try {
      const link = await searchOnce(requestedAt);
      if (link) return link;
    } catch (e) {
      if (e instanceof MailboxAuthError) throw e; // fatal : ne pas boucler 3 min
      console.error("[mailbox] erreur transitoire:", (e as Error).message);
    }
    polls += 1;
    console.log(`[mailbox] pas encore de lien frais (essai ${polls})…`);
    await sleep(8_000);
  }
  return null;
}
