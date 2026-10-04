"use client";

import { useCallback, useEffect, useState } from "react";
import { UserMenu } from "../user-menu";

interface U {
  id: string;
  role: "admin" | "user";
  phone: string;
  email: string;
  hasAgentToken: boolean;
  smsDailyLimit: number;
  disabled: boolean;
  createdAt: string;
}

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

/** Mot de passe aléatoire lisible (à transmettre une fois, à changer ensuite). */
function randomPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export default function AdminPage() {
  const [users, setUsers] = useState<U[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", password: randomPassword(), phone: "", email: "" });

  const load = useCallback(async () => {
    try {
      const j = await send("/api/admin/users", "GET");
      setUsers(j.users);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const msg = await fn();
      if (msg) setInfo(msg);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          skan · comptes
        </div>
        <UserMenu
          links={
            <a href="/" className="modal-link" style={{ marginTop: 0 }}>
              ← Dashboard
            </a>
          }
        />
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="token-box">{info}</div>}

      <section className="scard">
        <h2>Créer un compte</h2>
        <p className="hint">
          Chaque compte a ses propres surveillances, réglages, garants (chiffrés avec sa propre clé),
          missions et alertes. Personne ne voit les données d&apos;un autre — toi compris via l&apos;app.
        </p>
        <div className="grid2">
          <label>
            Identifiant (minuscules, chiffres, - _)
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
              placeholder="paul"
            />
          </label>
          <label>
            Mot de passe provisoire
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label>
            Téléphone (+33…, optionnel)
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            Email (optionnel)
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
        </div>
        <div className="row-actions">
          <button
            className="btn"
            disabled={busy || !form.username}
            onClick={() =>
              act(async () => {
                await send("/api/admin/users", "POST", form);
                const msg = `Compte créé — à envoyer à la personne :\n\n${origin}/login\nIdentifiant : ${form.username}\nMot de passe : ${form.password}\n\n(elle le change dans Settings → Mon compte, et génère son jeton d'agent dans Settings → Mon agent)`;
                setForm({ username: "", password: randomPassword(), phone: "", email: "" });
                return msg;
              })
            }
          >
            Créer le compte
          </button>
        </div>
      </section>

      <section className="scard">
        <h2>Comptes</h2>
        {!users ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="table-scroll">
            <table className="user-table">
              <thead>
                <tr>
                  <th>Identifiant</th>
                  <th>Contact</th>
                  <th>SMS/jour</th>
                  <th>Agent</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.id}</b>
                      {u.role === "admin" && <span className="muted"> · admin</span>}
                    </td>
                    <td className="muted">
                      {u.phone || "—"}
                      <br />
                      {u.email || "—"}
                    </td>
                    <td>{u.smsDailyLimit > 0 ? u.smsDailyLimit : "∞"}</td>
                    <td>{u.hasAgentToken ? "✓ jeton" : "—"}</td>
                    <td>{u.disabled ? "désactivé" : "actif"}</td>
                    <td>
                      <div className="row-actions" style={{ marginTop: 0 }}>
                        <button
                          className="linkbtn"
                          disabled={busy}
                          onClick={() => {
                            const pw = randomPassword();
                            if (!confirm(`Réinitialiser le mot de passe de ${u.id} ?`)) return;
                            act(async () => {
                              await send(`/api/admin/users/${u.id}`, "PATCH", { password: pw });
                              return `Nouveau mot de passe de ${u.id} : ${pw}`;
                            });
                          }}
                        >
                          Mot de passe
                        </button>
                        <button
                          className="linkbtn"
                          disabled={busy}
                          onClick={() => {
                            const v = prompt(`Plafond SMS/WhatsApp par jour pour ${u.id} (0 = illimité)`, String(u.smsDailyLimit));
                            if (v === null) return;
                            act(async () => {
                              await send(`/api/admin/users/${u.id}`, "PATCH", { smsDailyLimit: Number(v) });
                            });
                          }}
                        >
                          Plafond SMS
                        </button>
                        <button
                          className="linkbtn"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await send(`/api/admin/users/${u.id}`, "PATCH", { disabled: !u.disabled });
                            })
                          }
                        >
                          {u.disabled ? "Réactiver" : "Désactiver"}
                        </button>
                        <button
                          className="linkbtn"
                          style={{ color: "#ef4444" }}
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`Supprimer ${u.id} ET toutes ses données (garants, missions…) ? Irréversible.`)) return;
                            act(async () => {
                              await send(`/api/admin/users/${u.id}`, "DELETE");
                              return `Compte ${u.id} supprimé.`;
                            });
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
