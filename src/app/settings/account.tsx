"use client";

import { useEffect, useState } from "react";
import { useMe } from "../user-menu";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
  return json;
}

/** Mon compte : coordonnées d'alerte, SMS de test, mot de passe. */
export function AccountSection() {
  const me = useMe();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) {
      setPhone(me.phone);
      setEmail(me.email);
    }
  }, [me]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!me) return null;

  return (
    <section className="scard">
      <h2>Mon compte · {me.id}</h2>
      <p className="hint">
        Les alertes (place dispo, GO, échecs…) partent vers CES coordonnées.
        {me.smsDailyLimit > 0 && ` Plafond : ${me.smsDailyLimit} SMS/WhatsApp par jour (au-delà, email seulement).`}
      </p>
      <div className="grid2">
        <label>
          Téléphone (+33…)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33612345678" />
        </label>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.com" />
        </label>
      </div>
      <div className="row-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await send("/api/me", "PATCH", { phone, email });
              return "Coordonnées enregistrées";
            })
          }
        >
          Enregistrer mes coordonnées
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const j = await send("/api/test-notify", "POST");
              const ok = Object.entries(j.channels ?? {})
                .map(([c, v]) => `${c} ${v ? "✓" : "✗"}`)
                .join(" · ");
              return `Test envoyé : ${ok || "aucun canal configuré"}`;
            })
          }
        >
          Envoyer un test
        </button>
      </div>

      <div className="grid2" style={{ marginTop: 18 }}>
        <label>
          Mot de passe actuel
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          Nouveau mot de passe (10+ caractères)
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
      </div>
      <div className="row-actions">
        <button
          className="btn secondary"
          disabled={busy || !current || !next}
          onClick={() =>
            run(async () => {
              await send("/api/me/password", "POST", { current, next });
              setCurrent("");
              setNext("");
              return "Mot de passe changé";
            })
          }
        >
          Changer le mot de passe
        </button>
      </div>
      {msg && (
        <div className={msg.ok ? "saved-ok" : "error"} style={{ marginTop: 10 }}>
          {msg.ok ? "✓ " : ""}
          {msg.text}
        </div>
      )}
    </section>
  );
}

/** Mon agent : jeton personnel + fichier .env à copier sur son PC. */
export function AgentSection() {
  const me = useMe();
  const [token, setToken] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) setHasToken(me.hasAgentToken);
  }, [me]);

  if (!me) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const envSnippet = token
    ? [
        `SKAN_URL=${origin}`,
        `AGENT_TOKEN=${token}`,
        "",
        "# Ton compte iBail (le magic link arrive sur cette adresse)",
        "IBAIL_EMAIL=",
        "GMAIL_IMAP_HOST=imap.gmail.com",
        "GMAIL_IMAP_PORT=993",
        "GMAIL_IMAP_USER=",
        "GMAIL_IMAP_APP_PASSWORD=",
      ].join("\n")
    : "";

  const generate = async () => {
    if (hasToken && !confirm("Régénérer le jeton ? L'agent qui utilise l'ancien s'arrêtera.")) return;
    setBusy(true);
    setError(null);
    try {
      const j = await send("/api/me/agent-token", "POST");
      setToken(j.token);
      setHasToken(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Révoquer le jeton ? Ton agent ne pourra plus rien faire.")) return;
    setBusy(true);
    setError(null);
    try {
      await send("/api/me/agent-token", "DELETE");
      setToken(null);
      setHasToken(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="scard">
      <h2>Mon agent (dépôt automatique iBail)</h2>
      <p className="hint">
        L&apos;agent tourne sur TON PC (Docker Desktop) avec TON compte iBail. Il se connecte à skan
        avec un jeton personnel : il ne voit que tes missions, jamais celles des autres, et n&apos;a
        aucun accès à la base ni à tes garants.
        {hasToken ? " Jeton actif." : " Aucun jeton pour l'instant."}
      </p>
      <div className="row-actions">
        <button className="btn" disabled={busy} onClick={generate}>
          {hasToken ? "Régénérer le jeton" : "Générer mon jeton"}
        </button>
        {hasToken && (
          <button className="btn danger" disabled={busy} onClick={revoke}>
            Révoquer
          </button>
        )}
      </div>
      {token && (
        <>
          <p className="hint">
            ⚠️ Copie-le maintenant : il ne sera plus affiché. Mets ces lignes dans le fichier{" "}
            <code>.env</code> à côté de <code>docker-compose.agent.yml</code>, complète iBail/Gmail,
            puis <code>docker compose -f docker-compose.agent.yml up -d</code>.
          </p>
          <div className="token-box">{envSnippet}</div>
          <div className="row-actions">
            <button
              className="btn secondary"
              onClick={() => navigator.clipboard?.writeText(envSnippet).catch(() => {})}
            >
              Copier
            </button>
          </div>
        </>
      )}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
