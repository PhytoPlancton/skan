# Spec — Page Settings « Auto-candidature » (par agent expert, 2026-07-07)

## 1. Sections, dans l'ordre

### 1.0 Bandeau d'état (sticky, visible partout dans l'app)
| Réglage | Contrôle | Défaut | Justification |
|---|---|---|---|
| Agent actif | toggle maître | OFF | kill switch à un geste, jamais enfoui |
| Pause | select 24h / 72h / 7j / jusqu'au… | — | « vacances / j'ai trouvé » sans déconfigurer |
| Session iBail | badge valide/expirée + « Reconnecter » | — | cause n°1 d'échec silencieux |

### 1.1 Mode global
Segmented control **MANUEL / HYBRIDE / FULL-AUTO** — défaut **HYBRIDE**. FULL-AUTO grisé
tant que < 2 soumissions HYBRIDE réussies (tooltip explicite) : l'autonomie se débloque par l'usage.

### 1.2 Résidences (29 cartes)
| Réglage | Contrôle | Défaut | Justification |
|---|---|---|---|
| Stratégie | select : alerte seule / coup de cœur / critères | alerte seule | double opt-in : le mode global ne suffit pas à armer une résidence |
| Priorité | rang 1-n (drag) | ordre d'ajout | départage quand 2 places s'ouvrent (un dépôt à la fois) |

Critères (si « critères ») : **Loyer max CC** (number €, requis — critère n°1 étudiant, charges
comprises) · **Type** (multi-select studio/T1/T1bis/T2/coloc, défaut studio+T1) · **Surface min**
(number m², optionnel) · **Lot disponible entre** (date-range, défaut 15/08→31/10 : une place
libre en mars est inutile pour une rentrée).

### 1.3 Cadence & plafonds (globaux)
| Réglage | Contrôle | Défaut | Justification |
|---|---|---|---|
| Fenêtre d'action | time-range | 08:30–22:00 | hors fenêtre → mise en file, dépôt à l'ouverture + jitter |
| Délai après détection | min–max (min) | 4–25 | casse la signature « dépôt en 30 s » ; les places partent en heures |
| Dépôts/jour | number (UI max 2) | 1 | volume réel 2-5/mois |
| Dépôts/semaine | number (UI max 4) | 3 | idem |
| Dossiers actifs simultanés | number (UI max 4) | 2 | « à l'étude » + « liste d'attente » comptent ; au plafond → retombe en alerte simple |

### 1.4 Dossier type (étape 4)
| Réglage | Contrôle | Défaut | Justification |
|---|---|---|---|
| Date d'entrée | « dès dispo du lot » + date plancher optionnelle | dès dispo | calcul : `max(dispo lot, plancher, aujourd'hui)` |
| Date de sortie | select durée 10/12 mois / « 31 août » / fixe | 12 mois | bail étudiant standard, cohérent vu d'ARPEJ |
| « Comment connu ARPEJ » | select (enum exact iBail) | « Internet » | réponse banale et stable ; option disparue = stop agent |
| Profil & garants | lien fiche (état civil, loyer actuel, contact d'urgence, 2 garants) + « vérifié le » | — | re-validation demandée tous les 6 mois |

L'attestation sur l'honneur n'est **pas** un réglage (§4).

### 1.5 Coffre à documents
Liste des ~15 pièces : statut, uploadée le, **expire le** (pré-calculé par type : certificat
scolarité → 31/08 N+1 ; avis d'imposition → 30/09 millésime suivant ; bulletins de paie garants
→ +60 j glissants ; CNI → date légale), badge vert/orange/rouge.
- **Seuil d'alerte expiration** — number jours — défaut 14 — prévenir avant qu'un dossier parte avec une pièce stale.
- Comportement pièce rouge : non réglable — FULL-AUTO dégrade en HYBRIDE (« pièce périmée —
  GO quand même ? ») ; jamais de soumission auto avec pièce expirée.
- Rappel mensuel auto pour les pièces glissantes (bulletins).

### 1.6 Notifications (matrice événement × SMS/WhatsApp/Email)
Défauts : place détectée → SMS+WA (existant) · dossier préparé + lien GO → SMS+WA · rappel GO
non cliqué à H+2 → toggle ON · soumis → WA+Email (récap + captures) · échec → SMS+Email ·
**intervention requise** (captcha/2FA/DOM/session) → les 3, minimum 1 canal imposé ·
pièce expire / plafond atteint → Email.

## 2. Garde-fous visibles
- **Kill switch** bandeau + réponse SMS « STOP » à tout message sortant.
- **Mode test (« à blanc »)** : évalue critères + pièces et notifie « aurait postulé »
  **sans jamais ouvrir iBail en écriture** (un vrai dry-run créerait un record côté iBail).
  ON par défaut à la première activation.
- **Journal** : table horodatée — détection, décision, **raison des non-actions**
  (« ignoré : 620 € > 590 € », « plafond semaine »), capture écran de chaque étape, statut iBail.
  Export CSV, rétention 90 j.
- **Compteurs** dépôts jour/semaine/mois vs plafonds, toujours affichés.

## 3. Erreurs classiques à éviter
1. **Silence sur les non-actions** : ne pas expliquer pourquoi l'agent n'a pas postulé détruit la confiance plus vite qu'un bug.
2. **Retry sans idempotence** : après timeout, le dossier a peut-être été créé — relire l'état du
   lot avant d'agir (« dossier déjà en cours » = succès, pas erreur).
3. **FULL-AUTO immédiat / defaults agressifs** : l'autonomie maximale se mérite, pas de plafonds hauts par défaut.
4. **Supposer le DOM stable** : un champ renommé = données fausses soumises ; valider le récap
   étape 4 contre le profil avant chaque soumission, mismatch = stop.
5. **Sur-notifier** : l'utilisateur mute et rate « intervention requise » ; hiérarchiser, regrouper le non-urgent.

## 4. Hardcodé, jamais un réglage
- Délai plancher ≥ 2 min ; fenêtre bornée 07:00–23:00 quoi qu'on configure.
- Plafonds absolus au-dessus de l'UI : 2/jour, 4/semaine, un seul dépôt à la fois.
- Zéro retry de soumission ; zéro contournement captcha/2FA (stop + alerte, non désactivable).
- Vérification « dossier existant pour ce lot » avant toute action.
- Attestation sur l'honneur : consentement explicite horodaté à l'activation ; hash du libellé
  vérifié à chaque dépôt, s'il change → intervention requise.
- Chiffrement du coffre ; ≥ 1 canal pour « intervention requise » ; journal non purgeable avant 30 j.
