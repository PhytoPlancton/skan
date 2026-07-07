# ARPEJ Watch — Surveillance de logements + alerte multi-canal

## Objectif
Un site qui surveille les résidences ARPEJ et alerte (Email + WhatsApp + SMS via EDJ Labs)
dès qu'une place se libère dans une résidence surveillée.

## Découverte technique (VALIDÉE)
- Le site ARPEJ expose une API JSON publique : `GET https://www.arpej.fr/wp-json/sn/residences`
- Réponse paginée : `{ residences: [...], total: 29, pages: 2 }` (15 / page) → boucler sur les pages.
- Chaque résidence : `ID`, `title`, `link`, `extra_data.available_rooms`, `extra_data.is_bookable`, prix, adresse, images.
- **Clé du signal** : l'API ne liste QUE les résidences réservables (available_rooms >= 1).
  - Camille Sée → `available_rooms: 1`  ✅ (= "1 logement disponible" sur le site)
  - Eole → **absente de la liste** = "Aucun logement disponible". Quand une place s'ouvre, Eole RÉAPPARAÎT.
- Donc : surveiller par `slug` (extrait du `link`). Présent + available_rooms>=1 = dispo ; absent = 0.
- Pas d'auth, pas de nonce. HTML inutile (le bloc dispo est injecté en JS depuis cette API).

## Architecture (alignée stack EDJ Labs)
- **Next.js (App Router, TS) + Tailwind**, container unique → pipeline GHCR → EDJ Labs → `skan.nmt.ovh`.
- **API décorrélée du front** : couche `lib/` (services purs) → routes `/api/*` → front qui consomme via fetch.
- **MongoDB Atlas** : état des surveillances + historique des alertes. Client singleton, maxPoolSize=5,
  fermeture propre sur SIGTERM/SIGINT (respect des 500 connexions partagées).
- **Polling** : `node-cron` interne (boot via `instrumentation.ts`) toutes les POLL_INTERVAL_MIN (défaut 5).
  Logique de check = service pur, aussi exposé via `POST /api/cron/check` (protégé par CRON_SECRET)
  pour pouvoir le déclencher manuellement / par scheduler externe. Déploiement en 1 replica.
- **Notifier** : 3 adapters (sms / whatsapp / email) vers `api.edj-labs.com`, tokens en env vars.
  Envoi en `Promise.allSettled` (un canal qui échoue ne bloque pas les autres). Log par canal.

## Logique de détection (anti-spam)
- Ajout d'une surveillance → on snapshot l'état courant comme baseline, SANS alerter.
- À chaque poll, pour chaque résidence surveillée :
  - dispo maintenant ET pas dispo avant → **ALERTE** (3 canaux) + maj baseline + lastNotifiedAt.
  - dispo→dispo → rien (déjà notifié).
  - dispo→0 → maj baseline (réarme pour la prochaine ouverture).
- Premier run : pas de spam des 29 résidences déjà dispo (baseline silencieuse).

## Modèle de données (Mongo, db = arpej-watch)
- `watches` : { slug, title, link, createdAt, lastAvailableRooms, lastAvailable, lastNotifiedAt }
- `alerts`  : { slug, title, availableRooms, channels:{sms,whatsapp,email}, createdAt }

## Variables d'environnement (injectées par EDJ Labs — JAMAIS dans le repo)
- MONGODB_URI, MONGODB_DB=arpej-watch
- EDJ_API_BASE=https://api.edj-labs.com
- EDJ_SMS_TOKEN, EDJ_WA_TOKEN, EDJ_EMAIL_TOKEN
- NOTIFY_PHONE (E.164, ex +33...), NOTIFY_EMAIL
- ENABLED_CHANNELS=sms,whatsapp,email
- POLL_INTERVAL_MIN=5
- CRON_SECRET
- PORT=3000, HOSTNAME=0.0.0.0

## Plan d'implémentation (par phases)
- [x] **Phase 0 — Scaffold** : Next.js+TS+Tailwind, gitignore (.env*), .env.example, next.config (standalone).
- [x] **Phase 1 — Cœur détection (sans réseau sortant)** :
  - [x] `lib/arpej.ts` : fetchAllResidences() (multi-pages) + parse slug.
  - [x] `lib/checker.ts` : diff baseline → liste d'alertes (fonction pure).
  - [x] Tests : unit checker (transitions) + intégration ARPEJ live (29 résidences, Eole absent, Camille=1).
- [x] **Phase 2 — Persistance + API** :
  - [x] `lib/db.ts` (singleton + close), `lib/repo.ts` (watches/alerts).
  - [x] routes : GET /api/residences (live + état), GET/POST/DELETE /api/watches, POST /api/cron/check, /api/health.
- [x] **Phase 3 — Dashboard** : liste des 29 résidences (badge dispo, prix, ville), toggle "surveiller",
      section "surveillées", historique des alertes. Front fetch /api/*.
- [x] **Phase 4 — Notifier 3 canaux** : adapters EDJ Labs, message FR, allSettled, log + persist alerts.
      Test SMS réel vers NOTIFY_PHONE (1 crédit) — UNIQUEMENT après accord explicite.
- [x] **Phase 5 — Boot poller** : instrumentation.ts → node-cron.
- [x] **Phase 6 — Déploiement** : Dockerfile multi-stage, workflow GitHub Actions (build→GHCR),
      README checklist EDJ Labs (10 Deploy Labels pour skan.nmt.ovh, env vars, DNS, 1 replica).

## Vérification (preuve avant "terminé")
- ARPEJ : appel live → 29 résidences, Eole absent, Camille Sée = 1.
- Checker : tests unitaires verts sur toutes les transitions.
- Dashboard : rendu local OK, toggle persiste en Mongo, /api/* répond.
- Notif : dry-run loggé ; 1 SMS de test réel reçu (après accord).
- Déploiement : doc complète et reproductible.

## En attente de toi (bloquants partiels)
1. **Email API** : endpoint exact + token (section EDJ Labs *Emailing → API & sender*) — absent du dump.
2. Destinataires : confirmer le tél (+33783483613 ?) et l'email de réception.
3. Sous-domaine : `skan.nmt.ovh` (validé) ✅
4. Sécurité : régénérer les tokens SMS/WhatsApp collés dans le chat (après setup).

## Notes
- WhatsApp EDJ Labs renvoie actuellement 500 sur tous les envois récents → canal codé mais à surveiller.
- Aucun nom/prénom nulle part (code, README, commits). Rester anonyme.

---

# v2 — AUTO-APPLY : candidature automatique iBail (conçu 2026-07-07)

## Pain
À chaque nouvelle place, tout le process iBail est à refaire (candidat, garants, ~15 PDFs, réservation).
Objectif : skan détecte une place → un agent dépose le dossier automatiquement.

## Décisions actées (par l'utilisateur)
- Exécution : **serveur EDJ Labs 24/7** (agent Playwright headless, session iBail persistée).
- Documents + données candidat/garants : **coffre chiffré AES-256-GCM** dans skan (clé env `VAULT_KEY`).
- Modes globaux : **MANUEL** (alerte seule) / **HYBRIDE** (agent prépare tout → SMS récap + lien signé « GO »
  → clic = soumission) / **FULL-AUTO** (soumet seul, notifie après). Démarrage en HYBRIDE.
- Par résidence : stratégie « coup de cœur » (postule quel que soit le prix) vs « critères » (prix max…).
- Page **Settings dédiée** (spec par agent expert — cf. section Settings ci-dessous).
- L'utilisateur assume l'attestation sur l'honneur en full-auto (docs signés par lui en amont).

## Découverte plateforme (captures iBail)
- Dépôt lié à un lot : `ibail.arpej.fr/records?availability_id=<id>` → record 4 étapes.
- Candidat + garants = entités réutilisables (« locataires déjà enregistrés », garants en 1 clic).
- ⚠️ À CONFIRMER : les pièces justificatives suivent-elles la réutilisation ? (test manuel utilisateur)
- Anti-doublon natif : « Vous avez déjà un dossier en cours pour ce lot ».
- Statuts dossiers : 0% en création / envoyé à l'étude / liste d'attente / refusé-hors délai.

## Architecture v2
1. **Auth skan** (PRÉALABLE — app publique aujourd'hui) : login mot de passe (hash bcrypt en env),
   cookie session signé. Protège dashboard + settings + coffre + APIs sensibles.
2. **Coffre** : upload des ~15 PDFs + formulaires candidat/garants via UI protégée →
   chiffrement AES-256-GCM avant persist (Binary Mongo), clé `VAULT_KEY` env, jamais en clair.
3. **Queue de missions** (Mongo `missions`) : détection place (mode hybride/auto + stratégie match)
   → mission `pending`. Idempotence stricte : 1 mission max par (résidence, lot).
4. **Agent applicant** (service `agent` du même stack, Playwright + Chromium) :
   poll missions → login iBail (session storageState chiffrée) → dépôt : réutilise candidat/garants,
   upload docs manquants depuis coffre, pré-remplit étape 4 →
   HYBRIDE : s'arrête, SMS récap + lien signé /go/<token> → clic = reprise + soumission.
   FULL-AUTO : soumet direct + SMS confirmation.
5. **Anti-spot (hardcodé)** : fenêtre horaire humaine, délai aléatoire avant action, 1 dépôt à la fois,
   0 retry agressif, stop+alerte sur captcha/2FA/DOM inattendu (jamais de contournement), plafonds/jour+semaine.
6. **Suivi dossiers** : scrape périodique « Mes dossiers » → statuts dans le dashboard skan.

## Phases (à valider avant implémentation)
- [ ] **A0 — Questions bloquantes** (cf. « En attente ») : auth iBail, test réutilisation docs, défauts étape 4.
- [ ] **A1 — Auth skan** (login + sessions + protection routes).
- [ ] **A2 — Coffre chiffré** (crypto lib + UI upload + statut/péremption des pièces).
- [ ] **A3 — Settings** (page + modèle de config) — spec complète : tasks/settings-spec.md.
- [ ] **A4 — Queue missions + matching stratégies** (logique pure testable).
- [ ] **A5 — Agent Playwright** : login + dépôt sur le dossier Camille Sée 0% existant en DRY-RUN
      (remplit tout, ne soumet JAMAIS) → preuve par captures.
- [ ] **A6 — Flux GO hybride** (lien signé, expiration, page de confirmation).
- [ ] **A7 — Suivi des dossiers** + notifications par événement.
- [ ] **A8 — Déploiement** : service agent dans le stack (image Playwright), env vars, doc.

## A0 — RÉSOLU (tests utilisateur 2026-07-07)
1. **Auth iBail = magic link par email** (pas de mot de passe, pas de captcha vu). Mail « Connexion à
   iBail » avec lien `ibail.arpej.fr/session?t=…`, expire ~15 min.
   → Stratégie agent : session Playwright persistée (storageState chiffré Mongo) ; si expirée →
   demande de lien depuis la page login → lecture du mail via **IMAP Gmail (app password)** →
   extraction de l'URL de session → reconnexion. Aucun mot de passe iBail à stocker.
2. **Réutilisation native confirmée** : candidat pré-rempli intégralement + **pièces justificatives
   transportées (vertes)** à la création du dossier. Les ~15 PDFs n'ont pas à être re-uploadés.
   **Garants : non pré-remplis** — lien « utiliser l'un de vos garants déjà enregistrés » présent,
   efficacité à confirmer (test 30 s) ; fallback = re-saisie par l'agent depuis données chiffrées.
3. **Étape 4** : date d'entrée = `max(J+1, dispo du lot)` (validé). Date de sortie + « Comment avez-vous
   connu ARPEJ » : réglages Settings (défauts = valeurs des dossiers passés).
4. **Découverte flux** : après soumission, **les garants reçoivent un lien de validation par email** à
   cliquer. Hors de notre contrôle → notification dédiée « préviens tes garants » + suivi statut +
   relance si non validé à H+N.

## Assistance IA optionnelle (proxy LLM perso de l'utilisateur)
- Env vars optionnelles `LLM_PROXY_URL` + `LLM_PROXY_KEY` (proxy ChatGPT self-hosted de l'utilisateur).
- Usage STRICT : quand l'agent rencontre un champ inconnu/subjectif → l'IA PROPOSE une valeur,
  incluse dans le SMS GO (« champ X inconnu, je propose Y — GO pour valider »). Jamais de soumission
  silencieuse ; en FULL-AUTO un champ inconnu dégrade la mission en hybride.
- Hors périmètre IA (toujours) : dates, montants, attestation, décision de soumettre.
- v2 : draft de réponses à la « Discussion » iBail (validées par lien) + classification des messages.
- Non configuré → comportement de base : stop + SMS intervention.

## Impact architecture (simplifications)
- Coffre v1 allégé : données garants + profil dossier-type chiffrés ; les PDFs (coffre complet avec
  péremption) passent en v1.5 (filet de sécurité si une pièce manque/expire — l'agent vérifie juste
  que chaque catégorie est verte, sinon intervention SMS).
- Secrets : plus de credentials iBail ; env vars = IMAP Gmail (app password) + VAULT_KEY + existants.
  ⚠️ App password Gmail = accès boîte complète → alternative proposée : filtre Gmail qui forward les
  mails iBail vers une boîte relais dédiée dont on stocke les creds (exposition minimale).
