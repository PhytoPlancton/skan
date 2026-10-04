"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface Filters {
  types: string[];
  /** null = minimum du compte ; 0 = peu importe pour cette résidence. */
  minSurface: number | null;
  maxRent: number | null;
}

interface OfferLike {
  key: string;
  name: string;
  description?: string;
  available?: number;
  surfaceMin: number | null;
  surfaceMax: number | null;
  rentMin: number | null;
  rentMax: number | null;
}

interface Data {
  filters: Filters;
  userMinSurface: number | null;
  live: { url: string; offers: OfferLike[] } | null;
  catalog: OfferLike[];
}

const PRESETS = [18, 20, 25, 30];

const r0 = (n: number) => Math.round(n);
function range(a: number | null, b: number | null, unit: string): string | null {
  if (a === null && b === null) return null;
  if (a === null || b === null || r0(a) === r0(b)) return `${r0((a ?? b)!)} ${unit}`;
  return `${r0(a)}–${r0(b)} ${unit}`;
}

const cap = (k: string) => k.replace(/\b\w/g, (c) => c.toUpperCase());

/** Surface réellement appliquée (résidence, sinon compte ; 0 = aucune). */
export function effectiveMin(f: Filters | null | undefined, userMin: number | null | undefined): number | null {
  const m = f?.minSurface ?? userMin ?? null;
  return m === 0 ? null : m;
}

/** Libellé court de ce qui déclenche une alerte : « ≥ 25 m² · Comfort Studio · ≤ 650 € ». */
export function filtersLabel(
  f: Filters | null | undefined,
  userMin?: number | null,
  names?: Map<string, string>,
): string {
  const min = effectiveMin(f, userMin);
  const parts: string[] = [];
  if (min !== null) parts.push(`≥ ${min} m²`);
  if (f?.types.length) parts.push(f.types.map((k) => names?.get(k) ?? cap(k)).join(", "));
  if (f?.maxRent != null) parts.push(`≤ ${f.maxRent} €`);
  return parts.length ? parts.join(" · ") : "Toutes les surfaces";
}

/**
 * Choix d'une surface minimale : « Peu importe », paliers courants, ou valeur libre.
 * value null = peu importe.
 */
export function SurfacePicker({
  value,
  onChange,
  noneLabel = "Peu importe",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  noneLabel?: string;
}) {
  const custom = value !== null && !PRESETS.includes(value);
  const [draft, setDraft] = useState(custom ? String(value) : "");
  useEffect(() => {
    if (value !== null && !PRESETS.includes(value)) setDraft(String(value));
  }, [value]);
  return (
    <div className="sp">
      <button type="button" className={`sp-opt${value === null ? " on" : ""}`} onClick={() => onChange(null)}>
        {noneLabel}
      </button>
      {PRESETS.map((p) => (
        <button key={p} type="button" className={`sp-opt${value === p ? " on" : ""}`} onClick={() => onChange(p)}>
          {p} m²
        </button>
      ))}
      <span className={`sp-opt sp-custom${custom ? " on" : ""}`}>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          placeholder="autre"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value && Number.isFinite(n) && n > 0) onChange(n);
          }}
        />
        m²
      </span>
    </div>
  );
}

/**
 * Détail d'une résidence surveillée :
 *  1. ce qui est dispo maintenant, type par type, avec « 🔔 prévenu » / « trop petit » ;
 *  2. la surface minimale pour cette résidence (par défaut : celle du compte) ;
 *  3. « Plus de critères » (type précis, loyer max), replié.
 */
export function WatchFilters({ slug, onSaved }: { slug: string; onSaved?: (f: Filters) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"account" | "custom">("account");
  const [min, setMin] = useState<number | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [maxRent, setMaxRent] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/watches/${slug}/filters`, { cache: "no-store" });
      const j: Data & { error?: string } = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Chargement impossible");
      setData(j);
      setMode(j.filters.minSurface === null ? "account" : "custom");
      setMin(j.filters.minSurface === 0 ? null : j.filters.minSurface);
      setTypes(j.filters.types);
      setMaxRent(j.filters.maxRent?.toString() ?? "");
      setMore(j.filters.types.length > 0 || j.filters.maxRent !== null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const known = useMemo(() => {
    const by = new Map<string, OfferLike & { available: number }>();
    for (const c of data?.catalog ?? []) by.set(c.key, { ...c, available: 0 });
    for (const o of data?.live?.offers ?? []) by.set(o.key, { ...o, available: o.available ?? 0 });
    return [...by.values()].sort(
      (a, b) => (a.surfaceMin ?? 0) - (b.surfaceMin ?? 0) || a.name.localeCompare(b.name, "fr"),
    );
  }, [data]);
  const names = useMemo(() => new Map(known.map((k) => [k.key, k.name])), [known]);

  const draft: Filters = {
    types,
    minSurface: mode === "account" ? null : (min ?? 0),
    maxRent: maxRent ? Number(maxRent) : null,
  };
  const effMin = effectiveMin(draft, data?.userMinSurface);

  /** Pourquoi ce type déclenche (ou non) une alerte, avec les critères en cours d'édition. */
  const verdict = (o: OfferLike): { ok: boolean; why: string } => {
    if (types.length && !types.includes(o.key)) return { ok: false, why: "type non choisi" };
    const big = o.surfaceMax ?? o.surfaceMin;
    if (effMin !== null && big !== null && big < effMin) return { ok: false, why: `trop petit (< ${effMin} m²)` };
    const cheap = o.rentMin ?? o.rentMax;
    if (draft.maxRent !== null && cheap !== null && cheap > draft.maxRent) {
      return { ok: false, why: `trop cher (> ${draft.maxRent} €)` };
    }
    return { ok: true, why: "tu seras prévenu" };
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/watches/${slug}/filters`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: draft }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Enregistrement impossible");
      setSaved(true);
      onSaved?.(j.filters);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return <p className="muted">Chargement des logements…</p>;
  if (!data) return <div className="error">{error}</div>;

  const liveAvail = (data.live?.offers ?? []).filter((o) => (o.available ?? 0) > 0);
  const touch = () => setSaved(false);

  return (
    <div className="wf">
      {/* 1. Ce qui est dispo maintenant */}
      <div className="wf-title">Disponible en ce moment</div>
      {data.live === null ? (
        <p className="hint">Détail par type indisponible pour l&apos;instant (iBail injoignable ou résidence pas encore reliée).</p>
      ) : liveAvail.length === 0 ? (
        <p className="hint">Aucune place libre dans cette résidence en ce moment.</p>
      ) : (
        <ul className="wf-live">
          {liveAvail.map((o) => {
            const v = verdict(o);
            return (
              <li key={o.key} className={v.ok ? "ok" : "ko"}>
                <span className="name">
                  {o.available} {o.name}
                </span>
                <span className="meta">
                  {[range(o.surfaceMin, o.surfaceMax, "m²"), range(o.rentMin, o.rentMax, "€")].filter(Boolean).join(" · ")}
                </span>
                <span className="why">{v.ok ? "🔔 " : ""}{v.why}</span>
              </li>
            );
          })}
        </ul>
      )}
      {data.live && (
        <a className="wf-link" href={data.live.url} target="_blank" rel="noreferrer">
          Voir sur iBail →
        </a>
      )}

      {/* 2. Surface minimale */}
      <div className="wf-title" style={{ marginTop: 16 }}>🔔 Me prévenir à partir de</div>
      <div className="sp">
        <button
          type="button"
          className={`sp-opt${mode === "account" ? " on" : ""}`}
          onClick={() => {
            touch();
            setMode("account");
          }}
        >
          Mon réglage ({data.userMinSurface ? `${data.userMinSurface} m²` : "toutes surfaces"})
        </button>
        <button
          type="button"
          className={`sp-opt${mode === "custom" ? " on" : ""}`}
          onClick={() => {
            touch();
            setMode("custom");
          }}
        >
          Autre pour cette résidence
        </button>
      </div>
      {mode === "custom" && (
        <div style={{ marginTop: 8 }}>
          <SurfacePicker
            value={min}
            onChange={(v) => {
              touch();
              setMin(v);
            }}
          />
        </div>
      )}

      {/* 3. Plus de critères */}
      <button type="button" className="linkbtn wf-more" onClick={() => setMore(!more)}>
        {more ? "▾" : "▸"} Plus de critères (type précis, loyer max)
      </button>
      {more && (
        <div className="wf-moreblock">
          <div className="wf-chips">
            <button
              type="button"
              className={`wf-chip${types.length === 0 ? " on" : ""}`}
              onClick={() => {
                touch();
                setTypes([]);
              }}
            >
              <span className="name">Tous les types</span>
            </button>
            {known.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`wf-chip${types.includes(k.key) ? " on" : ""}`}
                title={k.description}
                aria-pressed={types.includes(k.key)}
                onClick={() => {
                  touch();
                  setTypes((cur) => (cur.includes(k.key) ? cur.filter((x) => x !== k.key) : [...cur, k.key]));
                }}
              >
                <span className="name">{k.name}</span>
                <span className="meta">
                  {[range(k.surfaceMin, k.surfaceMax, "m²"), range(k.rentMin, k.rentMax, "€")].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
          {known.length === 0 && (
            <p className="hint">Les types de cette résidence apparaîtront ici dès qu&apos;une place s&apos;y sera ouverte.</p>
          )}
          <div className="wf-fields">
            <label>
              Loyer max
              <span className="wf-input">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={maxRent}
                  placeholder="—"
                  onChange={(e) => {
                    touch();
                    setMaxRent(e.target.value);
                  }}
                />
                €
              </span>
            </label>
          </div>
        </div>
      )}

      <div className="row-actions">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <span className={saved ? "saved-ok" : "muted"}>
          {saved ? "✓ " : ""}Alertes : {filtersLabel(draft, data.userMinSurface, names)}
        </span>
      </div>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
