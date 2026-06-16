# Leçons — arpej-watch

Format : [date] | ce qui a mal tourné | règle pour l'éviter

## Leçons de déploiement héritées (EDJ Labs / Traefik / GHCR) — à appliquer dès le départ
- [hérité] | 404 sur le domaine | Mettre les labels Traefik dans **Deploy Labels**, PAS "Labels" (Swarm ne lit que Deploy Labels).
- [hérité] | 404 sur le domaine | Cloudflare en **DNS only** (nuage gris) tant que tout n'est pas validé.
- [hérité] | 404 sur le domaine | Le `NOM-COMPLET-DU-STACK` dans les labels doit matcher le nom réel (avec suffixe UUID) — créer le stack, noter le nom, puis éditer les labels.
- [hérité] | Container "Rejected" | Rendre l'image GHCR **publique** (ou configurer le registry credential).
- [hérité] | Erreur 500 en prod | Vérifier les env vars + whitelister l'IP EDJ Labs (0.0.0.0/0) dans MongoDB Atlas Network Access.
- [hérité] | Saturation DB | **Toujours fermer / réutiliser** la connexion Mongo (singleton + close sur SIGTERM) — limite 500 connexions partagées.

## Leçons spécifiques skan
- [2026-06-16] | Test d'intégration "0 alerte" alors qu'on attendait une transition : la résidence choisie (Camille Sée) était devenue indisponible entre-temps. | L'API ARPEJ ne liste que les résidences dispo et l'état change en temps réel — pour tester une transition, choisir dynamiquement un slug actuellement `available=true`, jamais en dur.
- [2026-06-16] | Port 27017 déjà pris par un autre Mongo (arrstack-mongo) lors d'un test local. | Pour les Mongo jetables de test, mapper un port libre (27018+) et pointer MONGODB_URI dessus ; ne jamais écrire dans le Mongo d'une autre app.
