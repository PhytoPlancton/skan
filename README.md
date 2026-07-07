# skan

Veille des disponibilités de logements **ARPEJ**. Surveille les résidences de ton
choix et alerte sur **Email + WhatsApp + SMS** (API EDJ Labs) dès qu'une place se libère.

- Dashboard live des 29 résidences réservables (dispo, prix, ville)
- Surveillance par résidence (toggle), y compris des résidences à 0 logement
  (ex. Eole) ajoutées par URL/slug
- Détection par transition `indisponible → disponible` (anti-spam : une alerte par ouverture)
- Polling interne toutes les 5 min (configurable)

## Comment ça marche

Le site ARPEJ expose une API JSON (`/wp-json/sn/residences`) qui ne liste que les
résidences **réservables**. Une résidence absente = 0 logement. `skan` interroge
cette API, compare à l'état précédent (MongoDB) et notifie sur transition.

```
poller (node-cron, 5 min)  ──►  runCheck()
                                   ├─ fetch API ARPEJ
                                   ├─ diff avec l'état Mongo
                                   ├─ notify (SMS/WhatsApp/Email EDJ Labs)
                                   └─ persiste le nouvel état
```

## Stack
Next.js (App Router) · MongoDB · node-cron · container unique (1 replica).

## Développement local

```bash
npm install
cp .env.example .env        # renseigner MONGODB_URI au minimum
npm run test                # tests unitaires (détection)
npm run verify              # preuve live contre l'API ARPEJ
npm run dev                 # http://localhost:3000
```

Pour tester sans envoyer de vrais messages : `NOTIFY_DRY_RUN=1`.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `MONGODB_URI` | URI MongoDB Atlas (whitelister l'IP EDJ Labs : `0.0.0.0/0`) |
| `MONGODB_DB` | nom de base (déf. `skan`) |
| `EDJ_API_BASE` | `https://api.edj-labs.com` |
| `EDJ_SMS_TOKEN` | token API SMS (X-Api-Token) |
| `EDJ_WA_TOKEN` | token API WhatsApp |
| `EDJ_EMAIL_TOKEN` | token API Emailing |
| `EDJ_EMAIL_ENDPOINT` | endpoint email EDJ Labs (déf. `/email/send`) |
| `NOTIFY_PHONE` | numéro destinataire E.164 (ex. `+33…`) |
| `NOTIFY_EMAIL` | email destinataire |
| `ENABLED_CHANNELS` | `sms,whatsapp,email` |
| `POLL_INTERVAL_MIN` | minutes entre deux checks (déf. 5) |
| `CRON_SECRET` | protège `POST /api/cron/check` et `/api/test-notify` |

> ⚠️ **Secrets** : jamais commités. Injectés via les *Environment Variables* du stack EDJ Labs.

## API

| Route | Description |
|---|---|
| `GET /api/residences` | résidences live + état surveillé |
| `GET /api/watches` · `POST /api/watches` · `DELETE /api/watches/:slug` | gestion des surveillances |
| `GET /api/alerts` | historique des alertes |
| `POST /api/cron/check` | déclenche un check (header `x-cron-secret`) |
| `POST /api/test-notify` | envoi de test sur tous les canaux (header `x-cron-secret`) |
| `GET /api/health` | healthcheck |

## Déploiement (GitHub → GHCR → EDJ Labs → Cloudflare)

1. **Repo + image publique** : repo GitHub `skan`, push, rendre l'image GHCR publique.
2. **DNS Cloudflare** : enregistrement `A` `skan` → `79.137.79.153` (DNS only, nuage gris).
3. **Stack EDJ Labs** : service `web`, image `ghcr.io/phytoplancton/skan:latest`,
   network `traefik-public`, **1 replica**, variables d'environnement ci-dessus.
4. **Deploy Labels** (pas "Labels") — remplacer `NOM-COMPLET-DU-STACK` par le nom réel (avec UUID) :

```
traefik.enable                                                       = true
traefik.docker.network                                               = traefik-public
traefik.http.routers.NOM-COMPLET-DU-STACK.rule                       = Host(`skan.nmt.ovh`)
traefik.http.routers.NOM-COMPLET-DU-STACK.entrypoints                = websecure
traefik.http.routers.NOM-COMPLET-DU-STACK.tls.certresolver           = letsencrypt
traefik.http.services.NOM-COMPLET-DU-STACK.loadbalancer.server.port  = 3000
traefik.http.routers.NOM-COMPLET-DU-STACK-http.rule                  = Host(`skan.nmt.ovh`)
traefik.http.routers.NOM-COMPLET-DU-STACK-http.entrypoints           = web
traefik.http.middlewares.redirect-to-https.redirectscheme.scheme     = https
traefik.http.routers.NOM-COMPLET-DU-STACK-http.middlewares           = redirect-to-https
```

5. **Déploiement** : `git tag v0.1.0 && git push --tags` → workflow vert → Update du stack.

### À finaliser avant la prod
- **Email** : endpoint `https://api.edj-labs.com/email/send`, corps `{ recipients, subject, html }`.
  Renseigner `EDJ_EMAIL_TOKEN`. Tester : `POST /api/test-notify`.
- **WhatsApp** : gateway EDJ Labs renvoie actuellement `500` — canal codé mais à vérifier.
- **Sécurité** : régénérer les tokens SMS/WhatsApp s'ils ont fui.

---

## v2 — Auto-candidature (login skan + agent iBail)

### Auth de l'app (obligatoire dès qu'on stocke des données perso)
1. Générer le hash : `npm run hash-password -- 'ton-mot-de-passe'`
2. Sur le stack web `skan`, ajouter : `AUTH_PASSWORD_HASH=…`, `AUTH_SECRET=$(openssl rand -hex 32)`,
   `VAULT_KEY=$(openssl rand -hex 32)`.
3. Redéployer → l'app demande le mot de passe. `/settings` et le coffre deviennent accessibles.

> ⚠️ `VAULT_KEY` déchiffre garants/session iBail : sauvegarde-la, sa perte = coffre illisible.

### Gmail app password (lecture des magic links iBail)
1. compte Google → **Sécurité** → activer la **validation en 2 étapes**.
2. **Mots de passe des applications** → générer un mot de passe (16 caractères).
3. Le mettre dans `GMAIL_IMAP_APP_PASSWORD` (+ `GMAIL_IMAP_USER=nicolas.monniot14@gmail.com`).

### Stack agent (`skan-agent`)
Second stack EDJ Labs, image `ghcr.io/phytoplancton/skan-agent:latest` :
- **Ports** : vide · **Labels Traefik** : aucun (c'est un worker, pas de HTTP) · **1 replica**.
- **Networks** : réseau avec accès Internet (iBail, Gmail, EDJ, Mongo Atlas).
- **Env vars** : `MONGODB_URI`, `MONGODB_DB`, `VAULT_KEY`, `EDJ_*`, `NOTIFY_*`, `PUBLIC_APP_URL`,
  `IBAIL_EMAIL`, `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD` (mêmes valeurs que le web pour les partagées).
  Pas besoin de `AUTH_*` ni `CRON_SECRET` côté agent.

### Mise en service (progressive, recommandée)
1. Sur `/settings` : renseigner **garants** + **dossier type**, armer 1 résidence (« coup de cœur »),
   mode **HYBRIDE**, **mode à blanc ON**. Activer l'agent.
2. **Calibration** (dry-run, ne soumet/ne crée rien) sur le dossier brouillon existant :
   `docker exec <conteneur-agent> npx tsx agent/main.ts --calibrate` → vérifier les captures
   (collection Mongo `screenshots`) et les logs.
3. Désactiver le **mode à blanc** → la prochaine place arme une vraie mission hybride
   (dossier préparé + SMS avec lien GO ; rien n'est soumis sans ton clic).
4. Full-auto se débloque seul après 2 soumissions hybrides réussies.

### Garde-fous (rappel)
Un dépôt à la fois · fenêtre 07–23h · délai aléatoire · 2/jour, 4/semaine max · zéro retry ·
stop + SMS sur captcha/2FA/DOM inattendu · vérif « dossier déjà en cours » · journal des refus motivés.
Détails : `tasks/settings-spec.md`.
