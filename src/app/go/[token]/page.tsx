"use client";

import { use, useCallback, useEffect, useState } from "react";

interface Info {
  title: string;
  availableRooms: number;
  link: string;
  status: string;
  expired: boolean;
}

export default function GoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/go/${token}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Lien invalide");
      return;
    }
    setInfo(json);
    if (json.status === "approved" || json.status === "submitting" || json.status === "submitted") {
      setDone(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/go/${token}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Impossible de valider");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wrap login-wrap">
      <div className="brand">
        <span className="dot" />
        skan
      </div>
      <div className="login-card">
        {error && <div className="error">{error}</div>}
        {!info && !error && <p className="muted">Chargement…</p>}
        {info && (
          <>
            <div className="modal-title">{info.title}</div>
            <p className="muted">{info.availableRooms} logement(s) disponible(s)</p>
            {done ? (
              <>
                <div className="badge available" style={{ alignSelf: "flex-start" }}>
                  ✓ GO envoyé
                </div>
                <p className="muted">
                  L&apos;agent soumet ton dossier dans quelques instants. Tu recevras une
                  confirmation. Pense à prévenir tes garants (lien de validation par email).
                </p>
              </>
            ) : info.expired ? (
              <p className="muted">Ce lien a expiré. La place est peut-être encore dispo :{" "}
                <a className="modal-link" href={info.link} target="_blank" rel="noreferrer">
                  voir sur arpej.fr
                </a>
              </p>
            ) : (
              <>
                <p className="muted">
                  Le dossier est prêt et complet. Clique pour <b>soumettre</b> ta candidature à
                  ARPEJ (tu attestes sur l&apos;honneur l&apos;exactitude des informations).
                </p>
                <button className="btn" onClick={confirm} disabled={busy}>
                  {busy ? "Envoi…" : "🚀 GO — soumettre ma candidature"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
