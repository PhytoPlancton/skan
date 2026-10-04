"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Me } from "../user-menu";

type Channel = "sms" | "whatsapp" | "email";
type Step = "password" | "contact" | "residences" | "done";

interface Residence {
  slug: string;
  title: string;
  link: string;
  city: string;
  priceFrom: number | null;
  availableRooms: number;
  available: boolean;
  watched: boolean;
}

const CHANNELS: Array<{ id: Channel; icon: string; label: string; hint: string }> = [
  { id: "sms", icon: "💬", label: "SMS", hint: "Le plus rapide, marche partout" },
  { id: "whatsapp", icon: "🟢", label: "WhatsApp", hint: "Sur ton numéro WhatsApp" },
  { id: "email", icon: "✉️", label: "Email", hint: "Pratique pour garder une trace" },
];

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

/** Saisie FR tolérante : 06 12 34 56 78 → +33612345678. */
function toE164(raw: string): string {
  const s = raw.replace(/[\s.()-]/g, "");
  if (/^0[1-9]\d{8}$/.test(s)) return `+33${s.slice(1)}`;
  if (/^0033\d{9}$/.test(s)) return `+${s.slice(2)}`;
  return s;
}

const strip = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function OnboardingPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // mot de passe
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  // contact
  const [channels, setChannels] = useState<Channel[]>(["sms"]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);

  // résidences
  const [residences, setResidences] = useState<Residence[] | null>(null);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Figé au chargement : l'étape mot de passe reste dans la frise une fois faite.
  const [withPassword, setWithPassword] = useState(false);
  const steps: Step[] = withPassword
    ? ["password", "contact", "residences", "done"]
    : ["contact", "residences", "done"];

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("session expirée"))))
      .then((j) => {
        const u: Me = j.user;
        setMe(u);
        setPhone(u.phone);
        setEmail(u.email);
        setChannels(u.phone || u.email ? u.channels : ["sms"]);
        setWithPassword(u.mustChangePassword);
        setStep(u.mustChangePassword ? "password" : "contact");
      })
      .catch(() => (window.location.href = "/login"));
  }, []);

  const loadResidences = useCallback(async () => {
    const r = await fetch("/api/residences", { cache: "no-store" });
    if (r.ok) setResidences((await r.json()).items ?? []);
  }, []);

  useEffect(() => {
    if (step === "residences" || step === "done") loadResidences();
  }, [step, loadResidences]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  // ── Étape : mot de passe ─────────────────────────────────────────
  const savePassword = () =>
    run(async () => {
      if (next.length < 10) throw new Error("10 caractères minimum");
      if (next !== confirm) throw new Error("les deux mots de passe ne correspondent pas");
      await send("/api/me/password", "POST", { current, next });
      go("contact");
    });

  // ── Étape : contact ──────────────────────────────────────────────
  const needsPhone = channels.includes("sms") || channels.includes("whatsapp");
  const needsEmail = channels.includes("email");
  const toggleChannel = (c: Channel) =>
    setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const saveContact = async () => {
    const body: Record<string, unknown> = { channels };
    body.phone = needsPhone ? toE164(phone) : phone ? toE164(phone) : "";
    body.email = email.trim();
    const j = await send("/api/me", "PATCH", body);
    setMe(j.user);
    setPhone(j.user.phone);
  };

  const testContact = () =>
    run(async () => {
      setTestMsg(null);
      await saveContact();
      const j = await send("/api/test-notify", "POST");
      const parts = Object.entries(j.channels ?? {}).map(
        ([c, ok]) => `${CHANNELS.find((x) => x.id === c)?.label ?? c} ${ok ? "✓" : "✗"}`,
      );
      setTestMsg(parts.length ? `Message de test envoyé : ${parts.join(" · ")}` : "Aucun canal disponible");
    });

  const nextFromContact = () =>
    run(async () => {
      await saveContact();
      go("residences");
    });

  // ── Étape : résidences ───────────────────────────────────────────
  const watched = (residences ?? []).filter((r) => r.watched);
  const list = useMemo(() => {
    const q = strip(query.trim());
    return (residences ?? [])
      .filter((r) => !q || strip(`${r.title} ${r.city}`).includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, "fr"));
  }, [residences, query]);

  const toggleWatch = (r: Residence) =>
    run(async () => {
      if (r.watched) await send(`/api/watches/${r.slug}`, "DELETE");
      else await send("/api/watches", "POST", { slug: r.slug });
      await loadResidences();
    });

  const addUrl = () =>
    run(async () => {
      setUrlMsg(null);
      try {
        const j = await send("/api/watches", "POST", { url: url.trim() });
        setUrl("");
        setUrlMsg({ ok: true, text: `« ${j.status.title} » ajoutée — tu seras prévenu dès qu'une place s'ouvre.` });
        await loadResidences();
      } catch (e) {
        setUrlMsg({ ok: false, text: (e as Error).message });
      }
    });

  const finish = () =>
    run(async () => {
      await send("/api/me", "PATCH", { onboarded: true });
      window.location.href = "/";
    });

  if (!me || !step) {
    return (
      <main className="wrap onb">
        <p className="muted">Chargement…</p>
      </main>
    );
  }

  const idx = steps.indexOf(step);
  const chosen = CHANNELS.filter((c) => channels.includes(c.id));

  return (
    <main className="wrap onb">
      <div className="brand">
        <span className="dot" />
        skan
      </div>

      <ol className="onb-steps" aria-label="Étapes">
        {steps.map((s, i) => (
          <li key={s} className={i < idx ? "done" : i === idx ? "current" : ""}>
            <span className="num">{i < idx ? "✓" : i + 1}</span>
            <span className="lbl">
              {s === "password" ? "Sécurité" : s === "contact" ? "Alertes" : s === "residences" ? "Résidences" : "C'est prêt"}
            </span>
          </li>
        ))}
      </ol>

      {error && <div className="error">{error}</div>}

      {step === "password" && (
        <section className="scard onb-card">
          <h1>Bienvenue {me.id} 👋</h1>
          <p className="lead">
            skan surveille les résidences ARPEJ pour toi et te prévient <b>dès qu&apos;une place se
            libère</b>, pour que tu sois le premier à réserver. Trois petites étapes et c&apos;est réglé.
          </p>
          <h2>Choisis ton mot de passe</h2>
          <p className="hint">On t&apos;a donné un mot de passe provisoire : remplace-le par le tien.</p>
          <div className="onb-fields">
            <label>
              Mot de passe provisoire
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label>
              Nouveau mot de passe (10 caractères min.)
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label>
              Confirme-le
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && savePassword()}
              />
            </label>
          </div>
          <div className="onb-nav">
            <span />
            <button className="btn" disabled={busy || !current || !next || !confirm} onClick={savePassword}>
              Continuer →
            </button>
          </div>
        </section>
      )}

      {step === "contact" && (
        <section className="scard onb-card">
          {idx === 0 && <h1>Bienvenue {me.id} 👋</h1>}
          <h2>Comment veux-tu être prévenu ?</h2>
          <p className="hint">
            Quand une place s&apos;ouvre dans une de tes résidences, tu reçois un message avec le lien
            pour réserver. Les places partent vite : choisis ce que tu regardes le plus souvent.
            Tu peux en cocher plusieurs.
          </p>
          <div className="onb-channels">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`onb-channel${channels.includes(c.id) ? " on" : ""}`}
                onClick={() => toggleChannel(c.id)}
                aria-pressed={channels.includes(c.id)}
              >
                <span className="ico">{c.icon}</span>
                <span className="name">{c.label}</span>
                <span className="sub">{c.hint}</span>
                <span className="check">{channels.includes(c.id) ? "✓" : ""}</span>
              </button>
            ))}
          </div>

          <div className="onb-fields">
            {needsPhone && (
              <label>
                Ton numéro de portable
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="06 12 34 56 78"
                />
              </label>
            )}
            {needsEmail && (
              <label>
                Ton email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="toi@exemple.com"
                />
              </label>
            )}
          </div>

          <div className="row-actions">
            <button
              className="btn secondary"
              disabled={busy || channels.length === 0 || (needsPhone && !phone) || (needsEmail && !email)}
              onClick={testContact}
            >
              📨 M&apos;envoyer un message de test
            </button>
            {testMsg && <span className="saved-ok">{testMsg}</span>}
          </div>

          <div className="onb-nav">
            {idx > 0 && steps[idx - 1] !== "password" ? (
              <button className="linkbtn" onClick={() => go(steps[idx - 1])}>
                ← Retour
              </button>
            ) : (
              <span />
            )}
            <button
              className="btn"
              disabled={busy || channels.length === 0 || (needsPhone && !phone) || (needsEmail && !email)}
              onClick={nextFromContact}
            >
              Continuer →
            </button>
          </div>
        </section>
      )}

      {step === "residences" && (
        <section className="scard onb-card">
          <h2>Quelles résidences t&apos;intéressent ?</h2>
          <p className="hint">
            Coche celles que tu vises. Tu seras prévenu à chaque fois qu&apos;une place s&apos;y libère.
          </p>

          {watched.length > 0 && (
            <div className="onb-chips">
              {watched.map((r) => (
                <span key={r.slug} className="onb-chip">
                  ★ {r.title}
                  <button onClick={() => toggleWatch(r)} disabled={busy} aria-label={`Retirer ${r.title}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="onb-url">
            <div className="onb-url-title">Ta résidence n&apos;est pas dans la liste ?</div>
            <p className="hint" style={{ marginTop: 4 }}>
              C&apos;est normal : la liste ne montre que les résidences qui ont une place libre en ce
              moment. Celle que tu vises est sûrement complète — c&apos;est justement là que skan est
              utile. Ouvre sa page sur{" "}
              <a href="https://www.arpej.fr/fr/residences/" target="_blank" rel="noreferrer">
                arpej.fr
              </a>
              , copie le lien et colle-le ici :
            </p>
            <div className="addform">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url.trim() && addUrl()}
                placeholder="https://www.arpej.fr/fr/residence/…/"
                inputMode="url"
              />
              <button className="btn" disabled={busy || !url.trim()} onClick={addUrl}>
                + Ajouter
              </button>
            </div>
            {urlMsg && (
              <div className={urlMsg.ok ? "saved-ok" : "error"} style={{ marginTop: 8 }}>
                {urlMsg.text}
              </div>
            )}
          </div>

          <div className="onb-list-head">
            <span className="onb-url-title">Places libres en ce moment</span>
            <input
              className="onb-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔎 Ville ou nom…"
            />
          </div>

          {residences === null ? (
            <p className="muted">Chargement des résidences…</p>
          ) : list.length === 0 ? (
            <p className="muted">Aucune résidence ne correspond. Utilise le lien arpej.fr ci-dessus.</p>
          ) : (
            <div className="onb-list">
              {list.map((r) => (
                <button
                  key={r.slug}
                  type="button"
                  className={`onb-res${r.watched ? " on" : ""}`}
                  onClick={() => toggleWatch(r)}
                  disabled={busy}
                  aria-pressed={r.watched}
                >
                  <span className="check">{r.watched ? "★" : "☆"}</span>
                  <span className="body">
                    <span className="title">{r.title}</span>
                    <span className="meta">
                      {[r.city, r.priceFrom ? `dès ${Math.round(r.priceFrom)} €` : null, r.available ? `${r.availableRooms} dispo` : "complet"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="onb-nav">
            <button className="linkbtn" onClick={() => go("contact")}>
              ← Retour
            </button>
            <div className="row-actions" style={{ marginTop: 0 }}>
              {watched.length === 0 && (
                <button className="linkbtn" onClick={() => go("done")}>
                  Je choisirai plus tard
                </button>
              )}
              <button className="btn" disabled={busy || watched.length === 0} onClick={() => go("done")}>
                Continuer →
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="scard onb-card">
          <h1>C&apos;est prêt 🎉</h1>
          <p className="lead">skan vérifie les disponibilités toutes les 5 minutes, jour et nuit.</p>

          <div className="onb-recap">
            <div>
              <div className="k">Tu seras prévenu par</div>
              <div className="v">
                {chosen.map((c) => `${c.icon} ${c.label}`).join("  ·  ")}
                <div className="muted">
                  {[needsPhone ? me.phone || phone : null, needsEmail ? me.email || email : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div>
              <div className="k">Pour {watched.length > 1 ? `ces ${watched.length} résidences` : "cette résidence"}</div>
              <div className="v">
                {watched.length === 0 ? (
                  <span className="muted">Aucune pour l&apos;instant — ajoute-les depuis le tableau de bord.</span>
                ) : (
                  watched.map((r) => <div key={r.slug}>★ {r.title}</div>)
                )}
              </div>
            </div>
          </div>

          <h2>Comment ça marche</h2>
          <ul className="onb-how">
            <li>Une place se libère → tu reçois <b>un message avec le lien</b> de la résidence.</li>
            <li>
              <b>Réserve vite</b> sur arpej.fr : les places partent souvent en quelques heures.
            </li>
            <li>Un seul message par ouverture : pas de spam tant que la place reste libre.</li>
            <li>Tu peux ajouter ou retirer des résidences à tout moment depuis le tableau de bord (★).</li>
          </ul>

          <div className="onb-nav">
            <button className="linkbtn" onClick={() => go("residences")}>
              ← Retour
            </button>
            <button className="btn" disabled={busy} onClick={finish}>
              Aller au tableau de bord →
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
