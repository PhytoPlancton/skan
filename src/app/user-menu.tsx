"use client";

import { useEffect, useState } from "react";

export interface Me {
  id: string;
  role: "admin" | "user";
  phone: string;
  email: string;
  hasAgentToken: boolean;
  agentTokenCreatedAt: string | null;
  smsDailyLimit: number;
  channels: Array<"sms" | "whatsapp" | "email">;
  onboarded: boolean;
  mustChangePassword: boolean;
  minSurface: number | null;
}

/** Hook : le compte connecté (null tant que non chargé). */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j?.user ?? null))
      .catch(() => {});
  }, []);
  return me;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}

/** Barre « connecté en tant que … » (liens Admin / Déconnexion). */
export function UserMenu({ links }: { links?: React.ReactNode }) {
  const me = useMe();
  // Nouveau compte : parcours d'accueil avant tout le reste.
  useEffect(() => {
    if (me && !me.onboarded) window.location.replace("/onboarding");
  }, [me]);
  return (
    <div className="usermenu">
      {links}
      {me?.role === "admin" && (
        <a href="/admin" className="modal-link" style={{ marginTop: 0 }}>
          👥 Comptes
        </a>
      )}
      {me && <span className="muted">👤 {me.id}</span>}
      <button className="linkbtn" onClick={logout}>
        Déconnexion
      </button>
    </div>
  );
}
