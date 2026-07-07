"use client";

import { useCallback, useEffect, useState } from "react";

interface Item {
  slug: string;
  title: string;
  link: string;
  city: string;
  zipCode: string;
  priceFrom: number | null;
  availableRooms: number;
  available: boolean;
  watched: boolean;
}

interface Dashboard {
  items: Item[];
  total: number;
  availableCount: number;
  watchedCount: number;
  updatedAt: string;
}

interface Alert {
  slug: string;
  title: string;
  link: string;
  availableRooms: number;
  channels: Record<string, boolean>;
  createdAt: string;
}

interface HistoryPoint {
  day: string;
  availableRooms: number;
}

type Filter = "all" | "available" | "watched";

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Lundi (clé de semaine) du jour donné, en YYYY-MM-DD. */
function weekStartKey(dayStr: string): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Historique hebdomadaire : barres horizontales.
 * Ordonnée = semaines (ordonnées, plus récente en haut), abscisse = places dispo.
 */
function HistoryChart({ points }: { points: HistoryPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="muted">
        Pas encore de données — l&apos;historique se construit semaine après semaine
        à partir d&apos;aujourd&apos;hui.
      </p>
    );
  }

  const byWeek = new Map<string, number>();
  for (const p of points) {
    const k = weekStartKey(p.day);
    byWeek.set(k, Math.max(byWeek.get(k) ?? 0, p.availableRooms));
  }
  const weeks = [...byWeek.entries()]
    .map(([week, rooms]) => ({ week, rooms }))
    .sort((a, b) => (a.week < b.week ? 1 : -1)); // plus récente en haut

  const maxVal = Math.max(1, ...weeks.map((w) => w.rooms));
  const rowH = 30;
  const labelW = 64;
  const valW = 34;
  const padR = 10;
  const padT = 6;
  const padB = 24;
  const W = 580;
  const barX = labelW + 8;
  const barW = W - barX - valW - padR;
  const H = padT + weeks.length * rowH + padB;
  const fmtWeek = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Historique hebdomadaire des disponibilités"
    >
      {weeks.map((w, i) => {
        const y = padT + i * rowH;
        const len = Math.max(2, (w.rooms / maxVal) * barW);
        return (
          <g key={w.week}>
            <text x={labelW} y={y + rowH / 2 + 4} className="wlabel" textAnchor="end">
              {fmtWeek(w.week)}
            </text>
            <rect
              x={barX}
              y={y + 6}
              width={len}
              height={rowH - 14}
              rx={3}
              className={w.rooms > 0 ? "bar on" : "bar"}
            >
              <title>{`Semaine du ${fmtWeek(w.week)} : ${w.rooms} logement(s)`}</title>
            </rect>
            <text x={barX + len + 6} y={y + rowH / 2 + 4} className="wval">
              {w.rooms}
            </text>
          </g>
        );
      })}
      <line x1={barX} y1={H - padB + 4} x2={barX + barW} y2={H - padB + 4} className="axis" />
      <text x={barX} y={H - 5} className="xtick">0</text>
      <text x={barX + barW} y={H - 5} className="xtick" textAnchor="end">
        {maxVal} places dispo
      </text>
    </svg>
  );
}

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const [selected, setSelected] = useState<Item | null>(null);
  const [histWeeks, setHistWeeks] = useState(8);
  const [hist, setHist] = useState<HistoryPoint[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([
        fetch("/api/residences", { cache: "no-store" }),
        fetch("/api/alerts", { cache: "no-store" }),
      ]);
      if (!r.ok) throw new Error("Chargement des résidences impossible");
      setData(await r.json());
      if (a.ok) setAlerts((await a.json()).alerts ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let aborted = false;
    setHist(null);
    fetch(`/api/history/${selected.slug}?days=${histWeeks * 7}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!aborted) setHist(d.points ?? []);
      })
      .catch(() => {
        if (!aborted) setHist([]);
      });
    return () => {
      aborted = true;
    };
  }, [selected, histWeeks]);

  const toggleWatch = async (item: Item) => {
    setBusy(true);
    try {
      if (item.watched) {
        await fetch(`/api/watches/${item.slug}`, { method: "DELETE" });
      } else {
        await fetch("/api/watches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: item.slug }),
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addByQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = query.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          value.startsWith("http") ? { url: value } : { slug: value.toLowerCase() },
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ajout impossible");
      setQuery("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const items = (data?.items ?? []).filter((it) =>
    filter === "available" ? it.available : filter === "watched" ? it.watched : true,
  );

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          skan
        </div>
        <a href="/settings" className="modal-link" style={{ marginTop: 0 }}>
          ⚙️ Settings
        </a>
      </div>
      <p className="tagline">
        Veille des résidences ARPEJ — alerte Email + WhatsApp + SMS dès qu&apos;une place se libère.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="num">{data?.watchedCount ?? "—"}</div>
          <div className="lbl">surveillées</div>
        </div>
        <div className="stat">
          <div className="num">{data?.availableCount ?? "—"}</div>
          <div className="lbl">avec dispo</div>
        </div>
        <div className="stat">
          <div className="num">{data?.total ?? "—"}</div>
          <div className="lbl">résidences listées</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 15, paddingTop: 6 }}>
            {data ? fmtDateTime(data.updatedAt) : "—"}
          </div>
          <div className="lbl">dernière maj</div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="toolbar">
        <form className="addform" onSubmit={addByQuery}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Coller une URL arpej.fr (ex. Eole) ou un slug…"
          />
          <button className="btn" disabled={busy}>
            + Surveiller
          </button>
        </form>
        <div className="filters">
          {(["all", "available", "watched"] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Toutes" : f === "available" ? "Dispo" : "Surveillées"}
            </button>
          ))}
        </div>
      </div>

      {!data && !error && <p className="muted">Chargement…</p>}

      {data && items.length === 0 && (
        <div className="empty">Aucune résidence dans ce filtre.</div>
      )}

      <div className="grid">
        {items.map((it) => (
          <div
            key={it.slug}
            className={`card${it.watched ? " watched" : ""}`}
            onClick={() => setSelected(it)}
            title="Voir l'historique"
          >
            <div className="title">{it.title}</div>
            <div className="meta">
              {[it.city, it.priceFrom ? `dès ${Math.round(it.priceFrom)} €` : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
            <div className="foot">
              <span className={`badge ${it.available ? "available" : "none"}`}>
                {it.available ? `${it.availableRooms} dispo` : "Aucun dispo"}
              </span>
              <button
                className={`watch-btn${it.watched ? " on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWatch(it);
                }}
                disabled={busy}
              >
                {it.watched ? "★ Surveillée" : "☆ Surveiller"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Alertes récentes</h2>
      {alerts.length === 0 ? (
        <p className="muted">Aucune alerte envoyée pour l&apos;instant.</p>
      ) : (
        alerts.map((a, i) => (
          <div className="alert-row" key={`${a.slug}-${i}`}>
            <div>
              {a.title} — {a.availableRooms} logement(s)
              {Object.entries(a.channels).map(([c, ok]) => (
                <span key={c} className={`chan ${ok ? "ok" : "ko"}`}>
                  {c}
                </span>
              ))}
            </div>
            <span className="when">{fmtDateTime(a.createdAt)}</span>
          </div>
        ))
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">{selected.title}</div>
                <div className="muted">
                  {[selected.city, selected.priceFrom ? `dès ${Math.round(selected.priceFrom)} €` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
              </div>
              <button className="close" onClick={() => setSelected(null)} aria-label="Fermer">
                ✕
              </button>
            </div>

            <div className="modal-sub">
              <span className={`badge ${selected.available ? "available" : "none"}`}>
                {selected.available ? `${selected.availableRooms} dispo` : "Aucun dispo"}
              </span>
              <div className="filters">
                {[4, 8, 12].map((w) => (
                  <button
                    key={w}
                    className={histWeeks === w ? "active" : ""}
                    onClick={() => setHistWeeks(w)}
                  >
                    {w} sem.
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-label">Logements disponibles par semaine (pic)</div>
            {hist === null ? (
              <p className="muted">Chargement…</p>
            ) : (
              <HistoryChart points={hist} />
            )}

            <a className="modal-link" href={selected.link} target="_blank" rel="noreferrer">
              Voir sur arpej.fr →
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
