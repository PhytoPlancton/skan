"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Connexion impossible");
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="wrap login-wrap">
      <div className="brand">
        <span className="dot" />
        skan
      </div>
      <form className="login-card" onSubmit={submit}>
        <p className="muted">Accès protégé — entre le mot de passe.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
        />
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !password}>
          {busy ? "Connexion…" : "Entrer"}
        </button>
      </form>
    </main>
  );
}
