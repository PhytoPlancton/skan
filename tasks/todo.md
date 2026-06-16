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
