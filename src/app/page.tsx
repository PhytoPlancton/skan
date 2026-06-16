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

type Filter = "all" | "available" | "watched";

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

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
      <div className="brand">
        <span className="dot" />
        skan
      </div>
      <p className="tagline">
        Veille des résidences ARPEJ — alerte Email + WhatsApp + SMS dès qu'une place se libère.
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
          <div key={it.slug} className={`card${it.watched ? " watched" : ""}`}>
            <a className="title" href={it.link} target="_blank" rel="noreferrer">
              {it.title}
            </a>
            <div className="meta">
              {[it.city, it.priceFrom ? `dès ${Math.round(it.priceFrom)} €` : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
            <div className="foot">
              <span className={`badge ${it.available ? "available" : "none"}`}>
                {it.available
                  ? `${it.availableRooms} dispo`
                  : "Aucun dispo"}
              </span>
              <button
                className={`watch-btn${it.watched ? " on" : ""}`}
                onClick={() => toggleWatch(it)}
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
        <p className="muted">Aucune alerte envoyée pour l'instant.</p>
      ) : (
        alerts.map((a, i) => (
          <div className="alert-row" key={`${a.slug}-${i}`}>
            <div>
              <a href={a.link} target="_blank" rel="noreferrer">
                {a.title}
              </a>{" "}
              — {a.availableRooms} logement(s)
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
    </main>
  );
}
