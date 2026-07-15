"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GlobalMode = "manual" | "hybrid" | "auto";

interface Strategy {
  mode: "off" | "love" | "criteria";
  maxRent?: number;
  priority?: number;
}

interface Settings {
  agentEnabled: boolean;
  pausedUntil: string | null;
  mode: GlobalMode;
  testMode: boolean;
  hybridSuccessCount: number;
  actionWindowStart: string;
  actionWindowEnd: string;
  delayMinMin: number;
  delayMaxMin: number;
  maxPerDay: number;
  maxPerWeek: number;
  maxActiveApplications: number;
  strategies: Record<string, Strategy>;
  llmAssist: boolean;
}

interface Profile {
  defaultExitDate: string;
  howKnown: string;
  entryDateFloor: string;
}

type Guarantor = Record<string, string>;

interface ResidenceItem {
  slug: string;
  title: string;
  city: string;
  priceFrom: number | null;
  watched: boolean;
}

const EMPTY_PROFILE: Profile = {
  defaultExitDate: "08/08/2028",
  howKnown: "Bouche à oreilles",
  entryDateFloor: "",
};

// Champs iBail d'un garant : [clé, label, groupe]
const G_FIELDS: Array<[string, string]> = [
  ["situation", "Situation (ex. Salarié(e))"],
  ["civility", "Civilité (Monsieur/Madame)"],
  ["lastName", "Nom"],
  ["firstName", "Prénom"],
  ["email", "Email"],
  ["phone", "Téléphone (+33…)"],
  ["address", "Adresse"],
  ["zipCode", "Code postal"],
  ["city", "Ville"],
  ["country", "Pays"],
  ["nationality", "Nationalité"],
  ["birthDate", "Date de naissance (jj/mm/aaaa)"],
  ["birthCity", "Ville de naissance"],
  ["birthCountry", "Pays de naissance"],
  ["familyStatus", "Situation familiale"],
  ["kinship", "Lien de parenté"],
  ["companyName", "Entreprise"],
  ["employerAddress", "Adresse employeur"],
  ["employerZipCode", "CP employeur"],
  ["employerCity", "Ville employeur"],
  ["employerPhone", "Tél. employeur"],
  ["profession", "Profession"],
  ["hireDate", "Date d'embauche (jj/mm/aaaa)"],
  ["contractType", "Contrat (CDI…)"],
  ["taxIncomeN1", "Revenu fiscal N-1 (€)"],
  ["taxIncomeN2", "Revenu fiscal N-2 (€)"],
  ["monthlyNetIncome", "Revenus mensuels nets (€)"],
  ["monthlyFamilyAllowance", "Allocations familiales (€)"],
  ["otherMonthlyIncome", "Autres revenus mensuels (€)"],
  ["otherIncomeNature", "Nature autres revenus"],
  ["housingStatus", "Logement actuel (Propriétaire…)"],
  ["monthlyRent", "Loyer mensuel (€)"],
  ["otherMonthlyCharges", "Autres charges (€)"],
];

const emptyGuarantor = (): Guarantor =>
  Object.fromEntries(G_FIELDS.map(([k]) => [k, ""]));

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [resCodes, setResCodes] = useState<Record<string, string>>({});
  const [residences, setResidences] = useState<ResidenceItem[]>([]);
  const [vaultReady, setVaultReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openGuarantor, setOpenGuarantor] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r, v] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/residences", { cache: "no-store" }),
        fetch("/api/vault", { cache: "no-store" }),
      ]);
      const sj = await s.json();
      if (!s.ok) throw new Error(sj.error ?? "Chargement settings impossible");
      setSettings(sj.settings);
      if (r.ok) setResidences((await r.json()).items ?? []);
      setVaultReady(v.ok);
      if (v.ok) {
        const [p, g, c] = await Promise.all([
          fetch("/api/vault/applicationProfile", { cache: "no-store" }),
          fetch("/api/vault/guarantors", { cache: "no-store" }),
          fetch("/api/vault/reservationCodes", { cache: "no-store" }),
        ]);
        if (p.ok) {
          const pv = (await p.json()).value;
          if (pv) setProfile({ ...EMPTY_PROFILE, ...pv });
        }
        if (g.ok) {
          const gv = (await g.json()).value;
          if (Array.isArray(gv) && gv.length) setGuarantors(gv);
        }
        if (c.ok) {
          const cv = (await c.json()).value;
          if (cv && typeof cv === "object") setResCodes(cv);
        }
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sauvegarde settings impossible");
      setSettings(json.settings);
      if (vaultReady) {
        const [p, g, c] = await Promise.all([
          fetch("/api/vault/applicationProfile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: profile }),
          }),
          fetch("/api/vault/guarantors", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: guarantors }),
          }),
          fetch("/api/vault/reservationCodes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: resCodes }),
          }),
        ]);
        if (!p.ok || !g.ok || !c.ok) throw new Error("Sauvegarde du coffre impossible");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  const setStrategy = (slug: string, patch: Partial<Strategy>) =>
    setSettings((s) => {
      if (!s) return s;
      const cur = s.strategies[slug] ?? { mode: "off" as const };
      return { ...s, strategies: { ...s.strategies, [slug]: { ...cur, ...patch } } };
    });

  const autoLocked = (settings?.hybridSuccessCount ?? 0) < 2;
  const sortedResidences = useMemo(
    () =>
      [...residences].sort(
        (a, b) => Number(b.watched) - Number(a.watched) || a.title.localeCompare(b.title, "fr"),
      ),
    [residences],
  );

  if (!settings) {
    return (
      <main className="wrap">
        <div className="brand">
          <span className="dot" />
          skan · settings
        </div>
        {error ? <div className="error" style={{ marginTop: 20 }}>{error}</div> : <p className="muted">Chargement…</p>}
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          skan · settings
        </div>
        <a href="/" className="modal-link" style={{ marginTop: 0 }}>
          ← Dashboard
        </a>
      </div>

      {/* Bandeau d'état */}
      <div className="statusbar">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.agentEnabled}
            onChange={(e) => set("agentEnabled", e.target.checked)}
          />
          <span>
            Agent <b>{settings.agentEnabled ? "ACTIF" : "coupé"}</b>
          </span>
        </label>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.testMode}
            onChange={(e) => set("testMode", e.target.checked)}
          />
          <span>Mode à blanc (n&apos;écrit jamais sur iBail)</span>
        </label>
        <select
          value={settings.pausedUntil ? "paused" : ""}
          onChange={(e) => {
            const v = e.target.value;
            const hours = v === "24" ? 24 : v === "72" ? 72 : v === "168" ? 168 : 0;
            set(
              "pausedUntil",
              hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
            );
          }}
        >
          <option value="">Pas de pause</option>
          <option value="24">Pause 24 h</option>
          <option value="72">Pause 72 h</option>
          <option value="168">Pause 7 j</option>
          {settings.pausedUntil && (
            <option value="paused">
              En pause → {new Date(settings.pausedUntil).toLocaleString("fr-FR")}
            </option>
          )}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Mode global */}
      <section className="scard">
        <h2>Mode global</h2>
        <div className="seg">
          {(["manual", "hybrid", "auto"] as GlobalMode[]).map((m) => (
            <button
              key={m}
              className={settings.mode === m ? "active" : ""}
              disabled={m === "auto" && autoLocked}
              title={
                m === "auto" && autoLocked
                  ? `Se débloque après 2 soumissions hybrides réussies (${settings.hybridSuccessCount}/2)`
                  : undefined
              }
              onClick={() => set("mode", m)}
            >
              {m === "manual" ? "Manuel (alertes)" : m === "hybrid" ? "Hybride (GO par SMS)" : "Full-auto"}
            </button>
          ))}
        </div>
        <p className="hint">
          Hybride : l&apos;agent prépare le dossier complet puis attend ton clic « GO ».
          Full-auto {autoLocked ? `verrouillé (${settings.hybridSuccessCount}/2 hybrides réussies)` : "disponible"}.
        </p>
      </section>

      {/* Stratégies par résidence */}
      <section className="scard">
        <h2>Résidences</h2>
        <p className="hint">
          « Coup de cœur » = postule dès qu&apos;une place s&apos;ouvre, peu importe le prix.
          « Critères » = postule si le loyer ≤ ton max.
        </p>
        <div className="strat-list">
          {sortedResidences.map((r) => {
            const st = settings.strategies[r.slug] ?? { mode: "off" as const };
            return (
              <div className="strat-row" key={r.slug}>
                <div className="strat-name">
                  {r.title}
                  <span className="muted"> {r.city ? `· ${r.city}` : ""}</span>
                </div>
                <select
                  value={st.mode}
                  onChange={(e) =>
                    setStrategy(r.slug, { mode: e.target.value as Strategy["mode"] })
                  }
                >
                  <option value="off">Alerte seule</option>
                  <option value="love">💜 Coup de cœur</option>
                  <option value="criteria">Critères</option>
                </select>
                {st.mode === "criteria" && (
                  <input
                    type="number"
                    className="rent-input"
                    placeholder="Loyer max €"
                    value={st.maxRent ?? ""}
                    onChange={(e) =>
                      setStrategy(r.slug, {
                        maxRent: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                )}
                {st.mode !== "off" && (
                  <input
                    className="rent-input"
                    placeholder="Code résa (si réservé)"
                    title="Logement « contingent réservataire » : code fourni par l'école/CROUS/employeur. Laisse vide si le logement est en accès libre."
                    value={resCodes[r.slug] ?? ""}
                    onChange={(e) =>
                      setResCodes((c) => ({ ...c, [r.slug]: e.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="hint">
          « Code résa » : à remplir seulement si le logement est un{" "}
          <b>contingent réservataire</b> (accès sur code). Stocké chiffré. Vide = accès libre.
        </p>
      </section>

      {/* Cadence & plafonds */}
      <section className="scard">
        <h2>Cadence & plafonds</h2>
        <div className="grid2">
          <label>
            Fenêtre d&apos;action (début)
            <input
              type="time"
              value={settings.actionWindowStart}
              onChange={(e) => set("actionWindowStart", e.target.value)}
            />
          </label>
          <label>
            Fenêtre d&apos;action (fin)
            <input
              type="time"
              value={settings.actionWindowEnd}
              onChange={(e) => set("actionWindowEnd", e.target.value)}
            />
          </label>
          <label>
            Délai min après détection (min)
            <input
              type="number"
              value={settings.delayMinMin}
              onChange={(e) => set("delayMinMin", Number(e.target.value))}
            />
          </label>
          <label>
            Délai max (min)
            <input
              type="number"
              value={settings.delayMaxMin}
              onChange={(e) => set("delayMaxMin", Number(e.target.value))}
            />
          </label>
          <label>
            Dépôts max / jour (≤ 2)
            <input
              type="number"
              value={settings.maxPerDay}
              onChange={(e) => set("maxPerDay", Number(e.target.value))}
            />
          </label>
          <label>
            Dépôts max / semaine (≤ 4)
            <input
              type="number"
              value={settings.maxPerWeek}
              onChange={(e) => set("maxPerWeek", Number(e.target.value))}
            />
          </label>
          <label>
            Dossiers actifs max (≤ 4)
            <input
              type="number"
              value={settings.maxActiveApplications}
              onChange={(e) => set("maxActiveApplications", Number(e.target.value))}
            />
          </label>
        </div>
        <p className="hint">
          Bornes absolues (non modifiables) : fenêtre 07:00–23:00, délai ≥ 2 min, 2/jour,
          4/semaine, un seul dépôt à la fois.
        </p>
      </section>

      {/* Dossier type */}
      <section className="scard">
        <h2>Dossier type (étape 4)</h2>
        {vaultReady === false && (
          <div className="error">
            Coffre indisponible — configure AUTH_* et VAULT_KEY sur le serveur.
          </div>
        )}
        <div className="grid2">
          <label>
            Date de sortie souhaitée (jj/mm/aaaa)
            <input
              value={profile.defaultExitDate}
              onChange={(e) => setProfile({ ...profile, defaultExitDate: e.target.value })}
            />
          </label>
          <label>
            « Comment avez-vous connu ARPEJ ? »
            <input
              value={profile.howKnown}
              onChange={(e) => setProfile({ ...profile, howKnown: e.target.value })}
            />
          </label>
          <label>
            Plancher date d&apos;entrée (optionnel)
            <input
              placeholder="jj/mm/aaaa — vide = dès dispo"
              value={profile.entryDateFloor}
              onChange={(e) => setProfile({ ...profile, entryDateFloor: e.target.value })}
            />
          </label>
        </div>
        <p className="hint">Date d&apos;entrée envoyée = max(demain, dispo du lot, plancher).</p>
      </section>

      {/* Garants */}
      <section className="scard">
        <h2>Garants (coffre chiffré)</h2>
        <p className="hint">
          Utilisés si la réutilisation iBail ne remplit pas les garants. Stockés chiffrés
          (AES-256-GCM) — jamais en clair en base.
        </p>
        {guarantors.map((g, i) => (
          <div key={i} className="gua-block">
            <div className="gua-head">
              <b>
                Garant {i + 1} {g.firstName ? `— ${g.firstName}` : ""}
              </b>
              <div>
                <button
                  className="watch-btn"
                  onClick={() => setOpenGuarantor(openGuarantor === i ? null : i)}
                >
                  {openGuarantor === i ? "Replier" : "Éditer"}
                </button>{" "}
                <button
                  className="watch-btn"
                  onClick={() => setGuarantors(guarantors.filter((_, j) => j !== i))}
                >
                  Supprimer
                </button>
              </div>
            </div>
            {openGuarantor === i && (
              <div className="grid2">
                {G_FIELDS.map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      value={g[k] ?? ""}
                      onChange={(e) =>
                        setGuarantors(
                          guarantors.map((gg, j) =>
                            j === i ? { ...gg, [k]: e.target.value } : gg,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {guarantors.length < 2 && (
          <button
            className="watch-btn"
            onClick={() => {
              setGuarantors([...guarantors, emptyGuarantor()]);
              setOpenGuarantor(guarantors.length);
            }}
          >
            + Ajouter un garant
          </button>
        )}
      </section>

      {/* Divers */}
      <section className="scard">
        <h2>Assistance IA (optionnel)</h2>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.llmAssist}
            onChange={(e) => set("llmAssist", e.target.checked)}
          />
          <span>
            Champ inconnu rencontré → l&apos;IA propose une valeur dans le SMS GO (nécessite
            LLM_PROXY_URL côté serveur). Jamais de soumission silencieuse.
          </span>
        </label>
      </section>

      <div className="savebar">
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer tout"}
        </button>
        {saved && <span className="saved-ok">✓ Enregistré</span>}
      </div>
    </main>
  );
}
