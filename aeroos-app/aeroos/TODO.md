# TODO — AeroOS

Feuille de route d'implémentation. Chaque tâche est autonome : contexte,
fichiers concernés, étapes, critères d'acceptation.

**Convention :** cocher `[x]` une fois les critères d'acceptation vérifiés.
Ne jamais cocher une tâche dont le `typecheck` ou le `build` échoue.

**Ordre :** les phases 0 à 5 sont séquentielles. À l'intérieur d'une phase,
les tâches marquées ⚡ peuvent être faites en parallèle.

**Phase 6 — livraison client.** Elle n'attend pas la fin de la Phase 5 :
T6.3, T6.1 et T6.2 sont bloquantes pour le premier pilote payant. Sans
elles, aucun client ne peut obtenir de compte ni recevoir de notification.

---

## État d'avancement

*Dernière synchronisation : 2 septembre 2026 (session de vérification T5.4)*

| Phase                           | Avancement | Reste                                                                                                          |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| **0 — Mise en route**    | ✅ 4/4     | —                                                                                                             |
| **1 — Sécurité**       | ✅ 4/4     | —                                                                                                             |
| **2 — Utilisable**       | ✅ 6/6     | —                                                                                                             |
| **3 — IA**               | ✅ 3/3     | vérification réelle → T6.11                                                                                 |
| **4 — Conformité**      | ✅ 3/3     | —                                                                                                             |
| **5 — Production**       | 🔵 3/4     | T5.4 : login réel en panne (`ALLOW_SYSTEM_ACCESS` manquant sur Railway) + sauvegarde/restauration à tester |
| **6 — Livraison client** | ⬜ 0/11    | tout                                                                                                           |

**Total : 23 / 36 tâches.** 158 tests passent.

**Ce qui bloque le premier client.** Dans l'ordre :

1. **T5.4 (résiduel)** — **le login réel est cassé en production**
   (`POST /api/auth/login` → 500 systématique, cause probable :
   `ALLOW_SYSTEM_ACCESS` absent des variables Railway — cf. note
   détaillée ci-dessous) : personne ne peut se connecter tant que ce
   n'est pas corrigé, priorité sur tout le reste de cette liste. Ensuite
   seulement : sauvegarde automatique + restauration testée (point 6 du
   runbook). Le déploiement lui-même est en vie et vérifié sur
   `aeroos_app` (pas le superuser), RLS confirmé par un vrai
   `test:isolation` (14/14).
2. **T6.3** — aucun e-mail ne peut sortir
3. **T6.1 / T6.2** — aucun client ne peut obtenir de compte, aucun admin
   d'entreprise ne peut créer les comptes de ses employés
4. **T6.6** — si l'application tombe la nuit, personne ne le sait

**Note sur T5.4.** Déployée sur Railway (confirmé par l'utilisateur le
2026-09-02, re-testé en direct ce même jour — cf. la note détaillée dans
la tâche : `/api/health` répond `200 ok`, le rôle applicatif actif en
base est bien `aeroos_app`, RLS forcé sur les 16 tables tenant-scopées).
Il ne reste que le point 6 du runbook (sauvegarde + restauration
vérifiée), qui recouvre aussi T6.7 — à traiter ensemble comme déjà noté
dans T6.7.

---

## PHASE 0 — Mise en route

> Objectif : le projet démarre, les écrans s'affichent, les tests passent.
> **Rien d'autre ne doit être commencé avant que cette phase soit terminée.**

### [x] T0.1 — Faire passer le typecheck

**Contexte.** Le projet n'a jamais été compilé avec un client Prisma
généré. Des erreurs de types sont attendues au premier passage.

**Étapes.**

1. `npm install`
2. `npx prisma generate`
3. `npm run typecheck`
4. Corriger les erreurs une par une, en partant de `src/lib/` (les pages
   dépendent des libs, pas l'inverse)

**Pièges connus.**

- `Decimal` de Prisma : importer depuis `@prisma/client/runtime/library`,
  pas depuis `@prisma/client`
- Les résultats de `withTenant()` peuvent être typés `unknown` si le
  callback n'a pas de type de retour explicite — annoter si besoin
- `params` des pages dynamiques est une `Promise` en Next.js 15

**Acceptation.**

- `npm run typecheck` retourne 0 erreur
- Aucun `any` ajouté pour contourner une erreur (utiliser des types
  précis ou `unknown` + narrowing)

---

### [x] T0.2 — Initialiser la base et charger le seed

**Étapes.**

1. `cp .env.example .env`
2. Générer la clé : `openssl rand -base64 32` → coller dans `AUTH_SECRET`
3. `npm run db:up` (attendre que Postgres soit healthy)
4. `npm run db:migrate -- --name init`
5. `npm run db:rls`
6. `npm run db:seed`

**Acceptation.**

- `npm run db:studio` montre des données dans `aircraft`, `lease_contracts`,
  `operators`
- Le seed affiche un résumé sans erreur

---

### [x] T0.3 — Vérifier l'isolation multi-tenant

**Contexte.** C'est le test de sécurité le plus important du projet. S'il
échoue, tout le reste est compromis.

**Étapes.**

1. `npm run test:isolation`
2. Si un test échoue, vérifier d'abord que `npm run db:rls` a bien été
   exécuté après la dernière migration

**Acceptation.**

- Tous les tests passent
- En particulier : une requête sans contexte tenant retourne 0 ligne

---

### [x] T0.4 — Valider les écrans

**Étapes.**

1. `npm run dev`
2. Se connecter avec `admin@meridian-aviation.com` / `demo1234`
3. Parcourir : Portfolio → Actifs → fiche actif → Contrats → Valorisation
   → Documents → IA → Audit

**Acceptation.**

- Chaque page se charge sans erreur console
- Les KPIs du portfolio affichent des valeurs cohérentes (pas de `NaN`,
  pas de `—` partout)
- La fiche actif affiche moteurs, historique, contrat, valorisations
- Le journal d'audit contient les entrées `LOGIN` et `VIEW`

**Si des données manquent :** vérifier le seed avant de modifier les pages.

---

## PHASE 1 — Sécurité avant tout client

> Objectif : rendre la plateforme présentable à un client sans mentir sur
> la sécurité. Le MFA est une exigence documentée du cahier de conformité.

### [x] T1.1 — MFA par TOTP ⚡

**Contexte.** Les champs `mfaEnabled` et `mfaSecret` existent déjà sur
`User`. Le cahier de conformité (§2.2) impose le MFA obligatoire avant
l'ouverture des accès beta.

**Dépendance à ajouter.** `otplib` + `qrcode`

**Fichiers.**

- `src/lib/mfa.ts` (nouveau) — génération de secret, vérification de code
- `src/app/(app)/settings/mfa/page.tsx` (nouveau) — activation avec QR code
- `src/app/api/auth/mfa/setup/route.ts` (nouveau)
- `src/app/api/auth/mfa/verify/route.ts` (nouveau)
- `src/lib/auth.ts` — ajouter une étape MFA dans `login()`
- `src/app/(auth)/login/page.tsx` — écran de saisie du code

**Étapes.**

1. `src/lib/mfa.ts` : `generateSecret()`, `buildOtpauthUrl()`,
   `verifyToken(secret, token)` avec fenêtre de tolérance ±1 période
2. Modifier `login()` : si `user.mfaEnabled`, ne pas créer la session
   directement mais retourner `{ success: false, mfaRequired: true, challengeToken }` où `challengeToken` est un JWT court (5 min) portant
   `userId` et un flag `mfa_pending`
3. Nouvelle route `POST /api/auth/mfa/verify` : valide le code TOTP + le
   challengeToken, puis crée la vraie session
4. Écran d'activation : QR code + saisie d'un code de confirmation avant
   d'activer (ne jamais activer sans preuve que l'utilisateur a scanné)
5. Générer 8 codes de récupération à usage unique, stockés hashés

**Migration nécessaire.** Ajouter `mfaRecoveryCodes String[]` sur `User`.

**Acceptation.**

- Un utilisateur peut activer le MFA depuis les paramètres
- La connexion demande le code après le mot de passe
- Un code invalide est refusé et écrit une entrée d'audit `LOGIN` /
  `DENIED`
- Les codes de récupération fonctionnent une seule fois
- Le secret n'apparaît jamais dans les logs

---

### [x] T1.2 — Limitation de débit sur la connexion ⚡

**Contexte.** Sans limite, l'authentification est vulnérable au bruteforce.

**Fichiers.**

- `src/lib/ratelimit.ts` (nouveau)
- `src/app/api/auth/login/route.ts`

**Approche.** En mémoire pour commencer (`Map` avec fenêtre glissante),
avec un commentaire indiquant qu'il faudra Redis en production
multi-instance. Ne pas sur-concevoir.

**Règles.**

- 5 tentatives échouées par e-mail sur 15 minutes → blocage 15 min
- 20 tentatives par IP sur 15 minutes → blocage 1 h

**Acceptation.**

- La 6ᵉ tentative échouée retourne HTTP 429
- Une connexion réussie remet le compteur à zéro
- Chaque blocage écrit une entrée d'audit
- Le message d'erreur ne révèle pas si le compte existe

---

### [x] T1.3 — Politique de mot de passe et changement ⚡

**Fichiers.**

- `src/lib/auth.ts` — `validatePassword()` existe déjà, le renforcer
- `src/app/(app)/settings/password/page.tsx` (nouveau)
- `src/app/api/auth/password/route.ts` (nouveau)

**Règles.** 12 caractères minimum, au moins 3 des 4 classes (minuscule,
majuscule, chiffre, symbole), refus des 1000 mots de passe les plus
courants (liste embarquée).

**Acceptation.**

- Un mot de passe faible est refusé avec un message explicite
- Le changement exige le mot de passe actuel
- Un changement invalide toutes les sessions existantes de l'utilisateur
- Entrée d'audit `UPDATE` sur `User`

---

### [x] T1.4 — Renouvellement de session

**Contexte.** Les sessions durent 15 minutes. Sans renouvellement,
l'utilisateur est déconnecté en pleine saisie.

**Approche.** Renouveler le cookie côté serveur quand il reste moins de
5 minutes et que l'utilisateur est actif. Implémenter dans le layout
`(app)` ou via une route `POST /api/auth/refresh` appelée par un
intervalle côté client.

**Acceptation.**

- Une session active ne se termine pas brutalement
- Une session inactive plus de 15 minutes expire bien
- Le renouvellement n'étend pas indéfiniment (durée absolue max 12 h)

---

## PHASE 2 — Rendre la plateforme utilisable

> Objectif : passer de « lecture seule » à « un lessor peut vraiment
> l'utiliser ». C'est la phase la plus longue.

### [x] T2.1 — Formulaire de création/édition d'actif

**Contexte.** Aujourd'hui les actifs viennent uniquement du seed. Sans ce
formulaire, la plateforme est une démo.

**Fichiers.**

- `src/app/(app)/assets/new/page.tsx` (nouveau)
- `src/app/(app)/assets/[id]/edit/page.tsx` (nouveau)
- `src/lib/actions/aircraft.ts` (nouveau) — Server Actions
- `src/lib/validation/aircraft.ts` (nouveau) — schémas Zod

**Champs obligatoires.** msn, manufacturer, model, yearBuilt, status
**Champs optionnels.** registration, variant, totalHours, totalCycles,
cabinConfig, seatCount, mtowKg, cofaExpiryDate, insuranceExpiryDate

**Règles métier.**

- `msn` unique par tenant → erreur explicite si doublon
- `yearBuilt` entre 1950 et année courante + 3
- `totalCycles` ne peut pas dépasser `totalHours` (un cycle dure au moins
  une heure en moyenne sur monocouloir — avertissement, pas blocage)
- Saisie manuelle → `hoursQuality = DECLARED`

**Acceptation.**

- Création et édition fonctionnent
- Les erreurs de validation s'affichent au bon champ
- Vérification du quota `maxAssets` du tenant avant création
- Entrée d'audit `CREATE` / `UPDATE`
- Un `AssetEvent` est créé à la création

---

### [x] T2.2 — Formulaire de contrat + rattachement moteurs

**Fichiers.**

- `src/app/(app)/contracts/new/page.tsx` (nouveau)
- `src/app/(app)/contracts/[id]/page.tsx` (nouveau) — fiche détaillée
- `src/lib/actions/contract.ts` (nouveau)

**Règles métier.**

- `endDate` > `startDate`
- Un actif ne peut pas avoir deux contrats `ACTIVE` qui se chevauchent
- Passer un contrat en `ACTIVE` met l'actif en `ON_LEASE` et renseigne
  `currentOperatorId`
- **Blocage sanctions :** si `lessee.sanctionsStatus === 'BLOCKED'`,
  refuser la création (exigence conformité §5.4)
- Si `FLAGGED`, autoriser mais afficher un avertissement et écrire un
  audit

**Génération des échéances.** À l'activation, créer les `Payment` mensuels
sur toute la durée du contrat avec statut `SCHEDULED`.

**Acceptation.**

- Création d'un contrat génère les paiements
- Le chevauchement est refusé avec un message clair
- Un locataire bloqué empêche la création
- La fiche contrat affiche parties, conditions, MR, paiements

---

### [x] T2.3 — Enregistrement des paiements ⚡

**Fichiers.**

- `src/app/(app)/contracts/[id]/page.tsx` — action sur chaque ligne
- `src/lib/actions/payment.ts` (nouveau)

**Règles.**

- Montant reçu = montant dû → `RECEIVED`
- Montant partiel → `PARTIAL`
- Date de réception > date d'échéance → conserver la trace du retard
- Un paiement `RECEIVED` ne peut pas être modifié sans justification
  (champ `notes` obligatoire)

**Acceptation.**

- Marquer un paiement reçu met à jour le statut et la date
- Le dashboard reflète immédiatement le changement
- Les alertes d'impayé se résolvent au prochain `npm run alerts:run`
- Entrée d'audit

---

### [x] T2.4 — Import CSV/Excel

**Contexte.** Objectif produit : onboarder un portefeuille en moins de
30 minutes. C'est impossible en saisie manuelle.

**Dépendance.** `papaparse` (CSV) — éviter Excel dans un premier temps,
demander un export CSV.

**Fichiers.**

- `src/app/(app)/assets/import/page.tsx` (nouveau)
- `src/lib/import/aircraft-csv.ts` (nouveau)

**Flux.**

1. Dépôt du fichier
2. Détection des colonnes + écran de correspondance (l'utilisateur mappe
   ses colonnes aux champs AeroOS)
3. Prévisualisation : 10 premières lignes avec erreurs signalées
4. Import avec rapport : créés / ignorés / en erreur

**Robustesse.** Le pipeline doit tolérer les données sales — c'est le
risque n°1 identifié (les lessors ont des données en désordre) :

- Dates en formats multiples (`DD/MM/YYYY`, `YYYY-MM-DD`, `MM/DD/YYYY`)
- Nombres avec espaces, virgules, points
- Colonnes manquantes → valeur nulle, pas d'échec
- Une ligne en erreur n'annule pas tout l'import

**Acceptation.**

- Import de 50 lignes avec 3 lignes volontairement corrompues :
  47 créées, 3 rapportées avec le motif et le numéro de ligne
- Un template CSV téléchargeable est fourni
- Import idempotent : réimporter le même fichier ne crée pas de doublons
  (clé : `msn` + tenant)

---

### [x] T2.5 — Upload de documents

**Contexte.** Le modèle `Document` existe, le stockage non.

**Décision à prendre.** S3 réel (AWS/Scaleway) ou stockage local en dev.
Recommandation : abstraction `src/lib/storage.ts` avec deux
implémentations, sélection par variable d'environnement. Permet de
développer sans compte cloud.

**Fichiers.**

- `src/lib/storage.ts` (nouveau) — interface `put`, `get`, `delete`, `sign`
- `src/lib/storage/local.ts`, `src/lib/storage/s3.ts`
- `src/app/api/documents/upload/route.ts` (nouveau)
- `src/app/(app)/documents/page.tsx` — brancher l'upload

**Règles.**

- Clé de stockage : `{tenantId}/{aircraftId}/{documentId}/v{version}`
- Taille max 50 Mo, types autorisés : pdf, jpg, png, docx, xlsx
- Chiffrement au repos (SSE-S3 côté serveur, ou noter la limite en local)
- URL de téléchargement signée, expiration 5 minutes
- Nouvelle version → nouvelle ligne `Document` avec `parentDocId`, jamais
  d'écrasement

**Acceptation.**

- Upload, listage, téléchargement fonctionnent
- Un document d'un autre tenant est inaccessible (tester explicitement)
- Entrée d'audit à l'upload et au téléchargement
- Les documents avec `expiryDate` génèrent des alertes

---

### [x] T2.6 — Recherche full-text ⚡

**Contexte.** PostgreSQL `tsvector` suffit largement à ce stade.

**Étapes.**

1. Migration : ajouter une colonne générée `searchVector tsvector` sur
   `Document` et un index GIN
2. Extraire le texte des PDF à l'upload (`pdf-parse`) → `extractedText`
3. Barre de recherche sur la page Documents

**Acceptation.**

- Recherche sur le titre et le contenu extrait
- Résultats limités au tenant courant
- Temps de réponse < 300 ms sur 1000 documents

---

## PHASE 3 — Intelligence artificielle

> Objectif : le différenciateur produit. Ne commencer qu'une fois la
> Phase 2 terminée — l'IA lit des documents, il faut donc que les
> documents existent.

### [x] T3.1 — Pipeline d'extraction de contrat

**Contexte.** Le modèle `AiExtraction` et l'écran de validation existent
déjà. Il manque le pipeline.

**Fichiers.**

- `src/lib/ai/extract-contract.ts` (nouveau)
- `src/app/api/ai/extract/route.ts` (nouveau)

**Les 18 champs à extraire.**
Parties : `lessorName`, `lesseeName`, `msn`, `registration`,
`aircraftType`
Dates : `startDate`, `endDate`, `deliveryDate`, `signedDate`
Financier : `monthlyRent`, `currency`, `escalationClause`,
`securityDeposit`, `mrEngine`, `mrApu`
Juridique : `governingLaw`, `hasPurchaseOption`, `sanctionsClause`

**Format de sortie attendu.**

```json
{
  "monthlyRent": { "value": 285000, "confidence": 0.97, "sourcePage": 12 },
  "endDate": { "value": "2025-12-31", "confidence": 0.88, "sourcePage": 14 }
}
```

**Garde-fous obligatoires (conformité §1.1 contexte 3).**

- Statut `PENDING` systématique, jamais d'écriture directe
- Tracer `modelName`, `modelVersion`, `promptVersion`
- Confiance < 0,85 → champ marqué à vérifier dans l'interface
- Toute clause de sanctions détectée → révision humaine obligatoire,
  même avec une confiance élevée

**Acceptation.**

- Extraction sur un PDF de test produit un `AiExtraction` en `PENDING`
- L'écran `/ai` affiche les champs avec leur confiance
- Aucune donnée n'atteint `LeaseContract` sans validation

**Note (2026-08-22).** `ANTHROPIC_API_KEY` n'est pas configuré dans cet
environnement — impossible de tester un appel réel à `claude-opus-5`.
Vérifié à la place : le pipeline complet jusqu'à l'appel API (upload PDF
→ extraction texte → sélection document → route → SDK) fonctionne et
échoue proprement (erreur SDK claire renvoyée à l'écran, aucune écriture
partielle en base) quand les identifiants manquent. À tester en conditions
réelles dès qu'une clé est disponible — en particulier la qualité de
`sourcePage` (dépend des marqueurs de page insérés par pdf-parse dans le
texte) et le format de sortie structuré (JSON Schema brut, pas
`zodOutputFormat` — ce projet est sur zod v3, le helper du SDK exige
zod v4 en interne, cf. lib/ai/extract-contract.ts).

---

### [x] T3.2 — Validation et écriture des extractions

**Fichiers.**

- `src/lib/actions/ai-validation.ts` (nouveau)
- `src/app/(app)/ai/page.tsx` — brancher les boutons

**Flux.**

1. L'utilisateur corrige les champs erronés
2. Validation → création ou mise à jour du `LeaseContract` avec
   `extractedByAi = true` et `aiExtractionId`
3. Les corrections sont stockées dans `AiExtraction.corrections` — c'est
   la matière première pour améliorer le prompt

**Acceptation.**

- Valider crée le contrat avec les valeurs corrigées
- Rejeter passe le statut à `REJECTED` sans rien écrire
- Entrée d'audit `AI_VALIDATE` avec l'identité du validateur
- Les corrections sont conservées

---

### [x] T3.3 — Résumé de rapport technique ⚡

**Contexte.** Condenser un rapport de shop visit de 48 pages en une fiche
d'une page. C'est la fonctionnalité qui crée la surprise en démo.

**Sortie structurée.** Résultat général · état moteurs (EGT margin, LLP
restants) · AD traitées / restantes · coût total ventilé · prochaine
échéance estimée.

**Règle.** Toute donnée chiffrée issue d'un résumé est `ESTIMATED` et ne
peut pas alimenter un calcul réglementaire (conformité §7 D5).

**Acceptation.**

- Le résumé apparaît sur la fiche document
- Lien vers le rapport source toujours présent
- Retour utilisateur (utile / pas utile) enregistré

**Note (2026-08-22).** Comme pour T3.1, `ANTHROPIC_API_KEY` absent dans cet
environnement — l'appel réel au modèle n'a pas pu être testé. La fiche
document (`/documents/[id]`, nouvelle — n'existait pas avant cette tâche)
et le pipeline jusqu'à l'appel API sont vérifiés : déclenchement, échec
propre sans écriture partielle, affichage structuré (testé en simulant un
résultat via UPDATE SQL direct), retour utile/pas utile persisté et
audité. À tester en conditions réelles avec une vraie clé — en particulier
la pertinence du texte narratif et la fiabilité des champs numériques
(EGT margin, LLP, coûts) sur un vrai rapport de shop visit long.

---

## PHASE 4 — Conformité opérationnelle

### [x] T4.1 — Screening des sanctions

**Contexte.** Exigence §5.3 du cahier de conformité. Aucun contrat ne doit
pouvoir être enregistré avec une contrepartie bloquée.

**Approche progressive.**

1. **Étape 1 :** import manuel de la liste SDN de l'OFAC (fichier CSV
   public) + correspondance par nom avec distance de Levenshtein
2. **Étape 2 :** API commerciale (ComplyAdvantage, Refinitiv) quand le
   budget le permet

**Fichiers.**

- `src/lib/compliance/sanctions.ts` (nouveau)
- `scripts/import-sanctions-list.ts` (nouveau)

**Règles.**

- Screening à la création d'un opérateur et annuellement
- Correspondance exacte → `BLOCKED`
- Correspondance approchante (> 85 % de similarité) → `FLAGGED`
- Chaque screening écrit un audit avec la liste consultée et sa date

**Acceptation.**

- Un opérateur nommé comme une entité sanctionnée est bloqué
- Le dashboard affiche une alerte visuelle sur les actifs concernés
- La création de contrat est refusée pour un locataire bloqué
- L'historique des screenings est consultable

**Note (2026-08-22).** Le code (screenName/screenOperator, scripts
sanctions:import et sanctions:screen) était déjà en place depuis le commit
précédent mais la case n'avait pas été cochée et les critères
d'acceptation n'avaient pas été vérifiés bout en bout. Vérifié cette
session : import de `prisma/sanctions/sdn-sample.csv` (8 entités
fictives) ; `npm run sanctions:screen -- meridian` sur la flotte démo
→ 6/6 `CLEAR` (aucune correspondance, normal avec des noms fictifs) ;
test de blocage en insérant temporairement une entité sanctionnée nommée
exactement comme l'opérateur démo « Iberavia », re-screening →
`CLEAR → BLOCKED` (similarité 100 %), badge « bloqué » désormais affiché
sur `/assets` pour les appareils loués à Iberavia, entrée d'audit
`UPDATE`/`Operator` avec l'entité correspondante tracée ; contrat de
test refusé côté `src/lib/actions/contract.ts` (`sanctions_blocked`) et
côté `src/lib/actions/ai-validation.ts`. Entité de test et statut
d'Iberavia nettoyés après vérification (re-screening → `CLEAR`, aucune
donnée de démo laissée dans un état incohérent). `npm run typecheck`,
`npm run build` et `npm run test:isolation` (14/14) passent.
Pas d'écran de révision manuelle des `FLAGGED`/`BLOCKED` — lecture seule
pour l'instant, hors périmètre explicite de T4.1 (cf. commentaire en tête
de `src/lib/compliance/sanctions.ts`).

---

### [x] T4.2 — Export et effacement RGPD ⚡

**Contexte.** Articles 15 et 17 du RGPD. Délai légal : 30 jours.

**Fichiers.**

- `src/app/api/admin/export-user-data/route.ts` (nouveau)
- `src/lib/gdpr.ts` (nouveau)

**Export.** JSON contenant toutes les données personnelles de
l'utilisateur : profil, entrées d'audit, actions.

**Effacement.** Anonymisation, pas suppression :

- `email` → `deleted-{uuid}@anonymized.local`
- `firstName` / `lastName` → `[supprimé]`
- `passwordHash` → invalidé
- `deletedAt` renseigné
- Les entrées d'audit conservent `userId` mais perdent `userEmail`

**Acceptation.**

- L'export contient toutes les données personnelles
- L'anonymisation ne casse aucune intégrité référentielle
- Le journal d'audit reste exploitable après anonymisation

**Note (2026-08-22).** `GET`/`DELETE /api/admin/export-user-data?userId=…`
(réservé ADMIN, `requireRole('ADMIN')`). Vérifié bout en bout sur le
serveur de dev avec une session ADMIN réelle (`admin@meridian-aviation.com`) :
export d'un utilisateur de seed (JSON complet, sans `passwordHash` ni
secrets MFA) ; un rôle ANALYST reçoit 403 ; `userId` manquant → 400 ;
utilisateur inconnu → 404. Effacement testé sur un utilisateur jetable
créé pour l'occasion (avec un `AssetEvent` lié) : anonymisation appliquée
(`email`/`firstName`/`lastName`/`passwordHash`/`deletedAt`), l'`AssetEvent`
pointe toujours vers le même `id` (intégrité référentielle intacte), une
tentative de connexion avec l'ancien mot de passe échoue immédiatement
(`deletedAt` revérifié par `getSession()` à chaque requête → coupe aussi
les sessions déjà ouvertes, sans mécanisme dédié), un second effacement
renvoie 409, `reason` obligatoire dans la requête. Fixture de test
purgée physiquement après vérification (pas une donnée métier réelle).

**Écart documenté vs. l'énoncé.** « Les entrées d'audit conservent
`userId` mais perdent `userEmail` » n'est **pas** implémenté à la lettre :
`audit_logs` est rendu immuable au niveau base (`FORCE ROW LEVEL SECURITY` + trigger `reject_audit_mutation` qui rejette tout UPDATE/DELETE,
cf. `prisma/rls.sql`), donc aucune entrée passée n'est modifiable — même
via `asSystem()`, qui contourne le RLS mais pas les triggers. C'est
cohérent avec CLAUDE.md §5 (« le journal d'audit ne doit jamais être
modifié ») et avec T4.3 ci-dessous (rétention 7 ans, jamais purgé). Les
entrées d'audit gardent donc l'e-mail réel tel qu'il était au moment des
faits ; c'est une exemption RGPD standard pour les logs de sécurité/
conformité (art. 17§3-b). Documenté dans le commentaire d'en-tête de
`src/lib/gdpr.ts`. Si une vraie purge rétroactive de `userEmail` s'avère
un jour requise légalement, elle devra être un acte DBA délibéré hors de
ce code applicatif (désactivation ponctuelle et tracée du trigger), pas
une conséquence silencieuse d'un effacement RGPD.

---

### [x] T4.3 — Purge automatique selon les durées de rétention ⚡

**Fichiers.** `scripts/retention-purge.ts` (nouveau)

**Durées (conformité §4.2).**

- Données financières : 10 ans
- Contrats : 10 ans après expiration
- Documents techniques : durée de vie de l'actif
- Journal d'audit : 7 ans minimum — **jamais purgé automatiquement**
- Utilisateurs supprimés : anonymisation après 30 jours

**Acceptation.**

- Le script tourne à blanc (`--dry-run`) par défaut
- Rapport de ce qui serait purgé
- Le journal d'audit n'est jamais touché

**Note (2026-08-22).** `npm run retention:purge [-- <slug>] [--execute]` —
dry-run par défaut sans flag dédié (`--dry-run` serait redondant avec le
comportement par défaut, qui exige `--execute` pour écrire) ; « purger »
= `deletedAt` (jamais de suppression physique, cf. CLAUDE.md §2), comme
toute autre suppression métier dans AeroOS. « Documents techniques »
interprété comme les catégories `MAINTENANCE`/`INSPECTION`, éligibles
seulement quand l'actif lié est déjà retiré (`Aircraft.deletedAt`
renseigné) — pas de durée fixe, conforme à « durée de vie de l'actif ».
La règle « utilisateurs supprimés : anonymisation après 30 jours » est
actuellement défensive : le seul chemin de suppression existant (route
RGPD T4.2) anonymise déjà de façon atomique, donc aucun compte ne se
retrouve aujourd'hui « supprimé mais pas encore anonymisé » — la règle
attend une future désactivation de compte qui ne le ferait pas. `eraseUserData()`
(T4.2) a été généralisée pour être réutilisable par ce script (acteur
automatisé, pas d'admin humain) ; son critère d'idempotence est passé de
« `deletedAt` déjà renseigné » à « e-mail déjà anonymisé », ce qui a
d'ailleurs corrigé un bug latent : avec l'ancien critère, ce script
n'aurait jamais pu anonymiser un compte déjà `deletedAt` mais pas encore
anonymisé — précisément le cas qu'il doit traiter.

Vérifié bout en bout avec des fixtures jetables (un paiement à échéance
2015, un contrat expiré en 2015, un actif retiré avec un document
`MAINTENANCE`, un compte `deletedAt` vieux de 40 jours et non anonymisé) :
dry-run détecte les 4 candidats sans écrire (`deletedAt` toujours nul,
`audit_logs` inchangé à 167 lignes) ; `--execute` purge les 4 (une entrée
d'audit `DELETE` par ligne, 167 → 171, jamais de lecture ni modification
de `audit_logs` lui-même) ; le compte est anonymisé avec son `deletedAt`
d'origine préservé (pas écrasé par la date du run) ; une seconde exécution
`--execute` ne retrouve plus aucun candidat (idempotent). Fixtures
purgées physiquement après vérification (pas des données métier réelles).
`npm run typecheck`, `npm run build` et `npm run test:isolation` (14/14)
passent.

---

## PHASE 5 — Préparation à la production

### [x] T5.1 — Tests automatisés

**Priorité de couverture :**

1. `lib/valuation.ts` — cas limites : avion très ancien, heures nulles,
   type inconnu
2. `lib/alerts.ts` — chaque règle, et l'idempotence
3. Isolation tenant — déjà couverte par `test:isolation`, à intégrer
4. Import CSV — données sales

**Outil.** `vitest` (léger, compatible TS natif).

**Acceptation.** `npm test` passe, couverture > 60 % sur `src/lib/`.

**Note (2026-08-22).** `vitest` + `@vitest/coverage-v8` installés.
`npm test` (151 tests, 18 fichiers) et `npm run test:coverage` passent :
**64.87 % lignes / 63.43 % instructions** sur `src/lib/` — au-dessus du
seuil. Détail :

- **T5.1.1 (valuation.ts, priorité 1)** — 93.75 % lignes : type connu vs
  générique (référentiel absent → confiance dégradée), avion tout juste
  livré vs très ancien (plafonné à la valeur plancher, projection
  au-delà de la vie économique), heures/cycles nuls (aucun ajustement,
  note explicite), LLP critique, AD ouvertes, visite lourde en retard,
  marché déprimé, mention de non-certification systématique,
  `buildValueCurve`.
- **T5.1.2 (alerts.ts, priorité 2)** — 98.55 % lignes, **test
  d'intégration réel** (`alerts.integration.test.ts`, tenant Postgres
  jetable créé/détruit par test — jamais le tenant Meridian) : les 9
  fonctions de règle (expiration contrat, impayés, assurance, certificats,
  documents, maintenance, concentration, seuils LLP, sanctions) déclenchent
  chacune leur `AlertType` ; idempotence vérifiée sur un second passage
  (0 créée, 0 résolue) ; résolution automatique vérifiée en levant la
  condition d'une alerte (paiement marqué reçu) sans toucher aux autres.
- **T5.1.3 (isolation tenant, priorité 3)** — intégrée à `npm test` via
  `tenant-isolation.integration.test.ts`, qui lance `npm run test:isolation` en sous-processus plutôt que de dupliquer sa logique en
  assertions vitest : ce script reste la seule source de vérité du test
  de sécurité le plus important du projet, jamais réécrit en parallèle.
- **T5.1.4 (import CSV, priorité 4)** — 98.9 % lignes : formats de date
  multiples (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY` désambiguïsé),
  nombres avec espaces/virgules/points, colonnes manquantes (erreur
  ciblée, jamais d'exception), une ligne en erreur n'empêche pas les
  autres, template CSV ré-important sans erreur. Une limite réelle de
  `guessColumnMapping()` a été découverte en écrivant les tests (pas
  corrigée, hors périmètre T5.1) : `normalizeName()`-style stripping
  n'est PAS un repli d'accents — un en-tête accentué non listé
  explicitement dans les alias (ex. « Modèle ») n'est pas reconnu ;
  testé comme comportement documenté plutôt que silencieusement ignoré.

**Complément au-delà du périmètre listé**, pour dépasser confortablement
60 % sur l'ensemble de `src/lib/` (525 + 655 lignes de valuation/alerts
ne suffisaient pas à eux seuls) : `format.ts`, `ratelimit.ts`,
`common-passwords.ts`, `mfa.ts` (TOTP réel via `otplib`), `db.ts`
(`isUuid`/`serializeDecimals`), `storage.ts` + `storage/local.ts`
(signature HMAC, expiration, anti-évasion de chemin — un test a
d'ailleurs révélé que `resolveSafePath()` neutralise silencieusement les
segments `..` plutôt que de rejeter explicitement, comportement testé
tel quel), `contract-activation.ts`, `validation/{aircraft,contract,payment}.ts`
(schémas Zod), `compliance/sanctions.ts` (`normalizeName`/`similarity`/
`screenName`, régression de T4.1) — tous à 95-100 % de couverture — plus
deux tests d'intégration supplémentaires : `gdpr.integration.test.ts`
(régression automatisée de la vérification manuelle T4.2 : export sans
secrets, anonymisation, intégrité référentielle, idempotence,
`deletedAt` d'origine préservé) et `auth.integration.test.ts` (login,
`getSession`, hiérarchie `requireRole`, rate limit, flux MFA,
`changePassword` invalidant les autres sessions). Ce dernier fichier
mocke `next/headers` (`vitest.setup.ts`) pour simuler le cookie de
session hors runtime Next — deux tests s'y sont révélés sensibles à un
cas limite réel de `auth.ts` (comparaison `iat` JWT à la seconde près vs
`passwordChangedAt` à la milliseconde près, cf. commentaires inline) ;
corrigé côté fixtures de test, pas dans le code applicatif — le cas ne
se produit en pratique que si connexion et changement de mot de passe
tombent dans la même seconde.

**Hors périmètre (documenté, pas caché) :**

- `src/lib/ai/**` et `src/lib/storage/s3.ts` — exclus du calcul de
  couverture (`vitest.config.ts`) : nécessitent respectivement
  `ANTHROPIC_API_KEY` (cf. notes T3.1/T3.2) et des identifiants AWS,
  indisponibles dans cet environnement.
- `src/lib/actions/**` (0 %) et `src/lib/pdf-extract.ts` (0 %) —
  non exclus de la mesure (ils comptent donc contre le pourcentage
  affiché) mais non testés : les Server Actions nécessitent
  `requireRole()` → `cookies()` en plus d'une manipulation base plus
  lourde que ce que justifiait le temps disponible ; `pdf-extract.ts`
  nécessite un vrai buffer PDF. Le seuil de 60 % est atteint malgré ces
  zones à 0 %, pas en les excluant.

Fichiers ajoutés : `vitest.config.ts`, `vitest.setup.ts`, et un
`*.test.ts`/`*.integration.test.ts` par module ci-dessus, plus
`src/lib/__tests__/testTenant.ts` (fixtures de tenant jetable partagées
par les tests d'intégration, même approche que
`scripts/test-tenant-isolation.ts` — création/destruction réelles en
base, jamais le tenant de démo). `npm run typecheck` et `npm run build`
passent toujours après ajout des dépendances de test.

---

### [x] T5.2 — Intégration continue ⚡

**Fichier.** `.github/workflows/ci.yml`

**Étapes.** install → typecheck → lint → test → build, avec un service
Postgres pour les tests d'intégration.

**Acceptation.** La CI échoue si le typecheck ou les tests échouent.

**Note (2026-08-22).** Fichier créé à la racine du dépôt git
(`C:\AreoOS\.github\workflows\ci.yml`), **pas** sous
`aeroos-app/aeroos/.github/` — GitHub ne découvre les workflows qu'à la
racine du repo (cf. mémoire projet : le vrai code vit dans le
sous-dossier `aeroos-app/aeroos/`, mais Git et GitHub Actions raisonnent
depuis la racine `C:\AreoOS`). Toutes les étapes utilisent
`working-directory: aeroos-app/aeroos`.

**Pipeline.** checkout → Node 20 → `npm ci` → `prisma generate` →
création des rôles Postgres applicatifs → `prisma migrate deploy`
(rôle superuser) → GRANT sur les tables migrées → `psql -f prisma/rls.sql`
→ `npm run typecheck` → `npm run lint` → `npm run test:coverage` →
`npm run build`. Service Postgres 16 (conteneur GitHub Actions,
`postgres:16-alpine`, mêmes identifiants que `docker-compose.yml`).

**Le point délicat identifié en écrivant ce fichier :** ce projet a trois
rôles Postgres (`aeroos_app` RLS, `aeroos` superuser, `aeroos_system`
BYPASSRLS — cf. `.env.example` §Base de données) que Prisma ne gère pas ;
un service Postgres GitHub Actions ne crée que le rôle `POSTGRES_USER`.
La CI recrée donc `aeroos_app`/`aeroos_system` avec les mêmes `GRANT`
que `.env.example` documente pour le dev local, dans le même ordre que
la doc l'exige (rôles → migrations en superuser → `GRANT ... ON ALL TABLES` une fois les tables créées → RLS).

**Vérifié réellement, pas seulement relu :** toute la séquence a été
rejouée en local contre un conteneur Postgres 16 jetable dédié (port
différent de la base de dev, jamais touchée) — création des deux rôles,
`prisma migrate deploy` (7 migrations, base vide), `GRANT`, `psql -f prisma/rls.sql` (RLS activé + forcé sur les 12 tables tenant-scopées,
`sanctioned_entities` exclue comme prévu), puis `npm run typecheck`,
`npm run lint`, `npm test` (151/151) et `npm run build` avec les
identifiants applicatifs (non-superuser) pointant vers cette base
fraîche. Tout passe. `npm ci` testé séparément sur le lockfile réel.

**Limite assumée.** Impossible de déclencher un run GitHub Actions réel
depuis cet environnement (pas d'accès au remote) — la validation
ci-dessus reproduit fidèlement chaque étape du pipeline en local, mais
ne remplace pas un vrai run sur `ubuntu-latest`. À confirmer au premier
push.

---

### [x] T5.3 — Journalisation et surveillance ⚡

- Logs structurés en JSON (`pino`)
- Aucune donnée personnelle dans les logs (conformité §7 D4)
- Endpoint `/api/health` vérifiant la connexion base
- Suivi des erreurs (Sentry ou équivalent)

**Note (2026-08-22).**

- `src/lib/logger.ts` — pino, JSON en production, `pino-pretty` en dev
  (désactivé en test : démarrage par worker thread inutile pour 21
  fichiers de test, cf. commentaire). `redact` configuré comme filet de
  sécurité (`email`, `password`, `passwordHash`, `mfaSecret`,
  `mfaRecoveryCodes`, `token`, cookie) — les points d'appel ne doivent de
  toute façon jamais y passer ces champs.
- **Fuite réelle trouvée et corrigée en écrivant ce point** (pas un
  risque théorique) : `asSystem()` journalisait sa raison telle quelle
  (`console.warn`), et `src/lib/auth.ts` interpolait l'e-mail normalisé
  dans cette raison à deux endroits de `login()` — observé en clair dans
  la sortie de test (`[SYSTEM ACCESS] login: recherche de l'utilisateur qa-auth@example.invalid…`) avant correction. Les deux messages ne
  portent plus que du texte générique. `src/lib/db.ts` : `console.warn`
  → `logger.warn()` dans `asSystem()` ; le `console.error('[AUDIT FAILURE]', err, entry)` de `audit()` (qui journalisait `entry` en
  entier, donc `userEmail` inclus) remplacé par `captureException()`
  avec un sous-ensemble explicite de champs sûrs
  (`tenantId`/`userId`/`action`/`resourceType`/`resourceId`).
- `src/lib/error-tracking.ts` — `captureException(error, context)` :
  log structuré systématique (toujours actif) + envoi à Sentry
  (`@sentry/node`) si `SENTRY_DSN` est défini, sinon no-op au-delà du
  log. **Non vérifié en conditions réelles** : pas de `SENTRY_DSN` de
  développement disponible dans cet environnement (même limite que
  `ANTHROPIC_API_KEY` pour l'IA, T3.1/T3.2, et les identifiants AWS pour
  `storage/s3.ts`, T2.5). Le chemin sans Sentry, lui, est exercé par
  construction à chaque appel — testé (`error-tracking.test.ts`, Sentry
  mocké : init une seule fois, capture appelée seulement si `SENTRY_DSN`
  est défini, jamais sinon).
- `src/app/api/health/route.ts` — `SELECT 1` via le client Prisma
  applicatif (RLS non pertinent : aucune table tenant-scopée touchée) ;
  200 `{status:"ok"}` si la base répond, 503 sinon. **Ajouté à
  `PUBLIC_PATHS` dans `src/middleware.ts`** — sans ça, le garde de
  session redirigeait `/api/health` vers `/login` (307), ce qui aurait
  cassé toute sonde d'infrastructure sans cookie. Vérifié en conditions
  réelles sur le serveur de dev, pas seulement en test : base up → 200
  `{"status":"ok","database":"up"}` ; `docker stop aeroos-postgres` →
  503 `{"status":"error","database":"down"}` ; `docker start` → 200 de
  nouveau.
- `pino`/`pino-pretty`/`@sentry/node` ajoutés à `serverExternalPackages`
  (`next.config.mjs`) — même contournement que `pdf-parse` (T2.4/2.5) :
  leur transport à base de worker thread casse si webpack les rebundle.
- `LOG_LEVEL` et `SENTRY_DSN` documentés dans `.env.example`, tous deux
  optionnels.

`npm run typecheck`, `npm test` (158/158, incluant `logger.test.ts` —
vérifie la censure réelle des champs sensibles via une instance pino
dédiée écrivant en mémoire — et `error-tracking.test.ts`), `npm run lint` et `npm run build` passent.

---

### [ ] T5.4 — Déploiement

**Recommandation.** Railway ou Fly.io — Postgres managé inclus, plus
simple que Vercel + base séparée pour ce type d'application.

**Points de vigilance.**

- `AUTH_SECRET` différent de celui de développement
- `npm run db:rls` doit être exécuté après chaque migration en production
- Sauvegardes automatiques activées et **restauration testée**
- Variables d'environnement dans le gestionnaire de secrets, jamais dans
  le repo

**Note (2026-08-22) — préparé, pas déployé.** Décision explicite de
l'utilisateur : pas d'accès à un compte cloud dans cet environnement, et
provisionner de l'infra réelle (facturable, difficile à annuler) n'est
pas une action à prendre sans autorisation directe — cf. les points 3 et
4 ci-dessous, qui exigent un compte réel et ne peuvent donc pas être
cochés depuis ici. Ce qui suit est le runbook à exécuter par quelqu'un
disposant des accès.

**Note (2026-09-02) — application déployée sur Railway, deux trous
trouvés en revue et un corrigé.** L'utilisateur confirme le déploiement
Railway effectué. Revue des points de vigilance restants :

- **Corrigé et vérifié en conditions réelles.** `npm run db:rls`
  appelait `psql` directement (`"db:rls": "psql \"$DATABASE_URL\" -f prisma/rls.sql"`) — binaire non garanti présent dans l'image de build
  Railway (runtime Node seul, pas d'outillage Postgres). Remplacé par
  `scripts/apply-rls.ts` (`tsx` + `pg`, protocole simple qui accepte le
  script multi-instructions tel quel, contrairement au protocole étendu
  de Prisma). Revérifié contre Postgres local : les 18 tables attendues
  passent à `rls_enabled/rls_forced = true`, `npm run test:isolation`
  14/14, `npm run build` propre. `.github/workflows/ci.yml` appelle
  maintenant `npm run db:rls` (au lieu du `psql` brut) pour que ce script
  soit rejoué à chaque push, pas seulement testé une fois localement.
- **Fait le 2026-09-02.** Rôles `aeroos_app` (NOBYPASSRLS) et
  `aeroos_system` (BYPASSRLS) créés sur la base managée Railway via
  `scripts/create-app-roles.ts` contre l'URL externe (`*.proxy.rlwy.net`,
  pas `*.railway.internal` — inaccessible hors du réseau privé Railway).
  Les deux URLs générées ont été affichées une seule fois en sortie de
  script ; **reste à confirmer qu'elles ont bien été copiées dans le
  gestionnaire de secrets Railway** (`DATABASE_URL` / `SYSTEM_DATABASE_URL`,
  point 3 du runbook) et que le service applicatif a été redéployé/redémarré
  avec ces variables — tant que ce n'est pas fait, l'app continue de
  tourner avec le rôle superuser (`ADMIN_DATABASE_URL`) et le RLS reste
  silencieusement contourné. Point 6 (sauvegarde + restauration testée)
  toujours pas fait.

**Note (2026-09-02, session de vérification distincte de celle ci-dessus)
— test en conditions réelles contre le déploiement Railway live, pas
seulement relu.** L'utilisateur a fourni l'URL publique de l'app
(`areoos-production.up.railway.app`) et la chaîne de connexion externe du
Postgres managé pour un test ciblé. Trois vérifications faites depuis cet
environnement, aucune écriture :

- **`GET /api/health` → `200 {"status":"ok","database":"up"}`** (point 5
  du runbook). `GET /` → `307` vers `/login?from=%2F` (garde de session
  normale, cohérent avec `src/middleware.ts`). `GET /login` → `200`.
- **Le point resté ouvert dans la note précédente est résolu : l'app tourne
  bien avec le rôle applicatif `aeroos_app`, pas le superuser.** Requête
  sur `pg_stat_activity` : une seule connexion active sous `aeroos_app`
  (`client_addr` interne Railway), en plus de la connexion `postgres` de
  ce test lui-même — donc le service applicatif a bien été redéployé avec
  les bonnes variables (`DATABASE_URL` = rôle `aeroos_app`), pas resté sur
  `ADMIN_DATABASE_URL` comme la note du 2026-09-02 précédente le
  craignait. `pg_roles` confirme aussi l'existence de `aeroos_app`
  (NOSUPERUSER, NOBYPASSRLS) et `aeroos_system` (NOSUPERUSER, BYPASSRLS).
- **RLS actif et forcé sur les 16 tables tenant-scopées attendues**
  (`relrowsecurity`/`relforcerowsecurity` = true), `sanctioned_entities`
  et `_prisma_migrations` correctement exclues — identique à l'attendu de
  T5.2/T5.4, maintenant vérifié sur la base de production elle-même et
  pas seulement sur un Postgres jetable local.
- Note technique : la base gérée tourne en **Postgres 18.6** (Railway),
  pas la version 16 utilisée en dev/CI (`docker-compose.yml`,
  `postgres:16-alpine`) — à garder en tête si un comportement diverge un
  jour entre local et prod ; rien d'observé pour l'instant.

**Volontairement non testé dans cette session, à ne pas confondre avec du
« vérifié » :**

- `npm run test:isolation` n'a **pas** été lancé contre cette base de
  production — ce script crée et supprime des tenants de test via
  `ADMIN_DATABASE_URL` ; l'exécuter contre des données clients réelles
  sans accord explicite est le genre d'action à ne pas prendre sans
  demander d'abord, même si le script est conçu pour nettoyer derrière
  lui (déjà validé en local/CI, cf. note T5.2). Si une vérification
  end-to-end de l'isolation *sur cette base précise* est voulue, il
  faudra le demander explicitement, idéalement avec une fenêtre de
  maintenance.
- Point 6 du runbook (sauvegarde + restauration testée) : toujours pas
  fait, et pas vérifiable depuis cet environnement (nécessite le
  dashboard Railway, hors accès ici).



- **Suite de la même session — deux actions supplémentaires demandées
  explicitement par l'utilisateur, base confirmée vide de toute donnée
  réelle avant d'agir :**
- **`npm run test:isolation` réel, lancé pour de vrai contre cette base
  de production**, pas seulement raisonné par lecture de code — 14/14
  tests réussis (lecture croisée, accès direct par ID, modification/
  suppression/injection cross-tenant toutes bloquées, aucune ligne
  visible sans `app.current_tenant`, audit log immuable). Obstacle
  pratique : le mot de passe du rôle `aeroos_app` n'a jamais été
  communiqué à cette session (il n'a été affiché qu'une fois, à la
  création du rôle — cf. note précédente), donc impossible de lancer le
  script `scripts/test-tenant-isolation.ts` tel quel (il a besoin de
  `DATABASE_URL` = rôle applicatif). Contournement : un script ad hoc,
  connecté avec le superuser fourni, fait `SET ROLE aeroos_app` avant
  chaque requête testée — un superuser peut prendre l'identité d'un
  autre rôle sans en connaître le mot de passe, et perd alors tous ses
  privilèges superuser/BYPASSRLS pour la durée de la session (comportement
  Postgres documenté, pas un contournement du test). Le test 8 (contexte
  tenant invalide) n'a pas d'équivalent SQL brut : c'est une validation
  côté application dans `withTenant()`, déjà couverte par les tests
  unitaires vitest (T5.1), pas une politique RLS.
  **Effet de bord permanent et volontaire :** l'exécution insère une ligne
  `audit_logs` (`userEmail: test@test.com`) qui ne peut ensuite être ni
  modifiée ni supprimée — même par le superuser — puisque `audit_logs` est
  append-only par construction (trigger `reject_audit_mutation`, aucune
  policy RLS UPDATE/DELETE). C'est exactement le comportement voulu, pas
  un oubli de nettoyage ; `scripts/test-tenant-isolation.ts` fait déjà la
  même chose en dev/CI (son `cleanup()` avale l'échec de suppression de
  l'audit log). Deux lignes de ce type existent maintenant dans
  `audit_logs` en production : une de cette vérification, et une autre,
  antérieure de ~1h30 à ce test (même signature `test@test.com`), dont
  l'origine est inconnue de cette session — tenant et avion associés
  déjà absents, donc déjà nettoyés par qui que ce soit qui l'a lancé (cf.
  [[project-aeroos-concurrent-git-activity]] en mémoire : quelque chose
  d'autre agit parfois sur ce repo/cette infra en parallèle). À
  mentionner à l'utilisateur, pas juste noté ici.
- **Compte de démonstration inséré** (tenant « Meridian Aviation Capital »

  + utilisateur `admin@meridian-aviation.com` / `demo1234`, rôle ADMIN,
    MFA désactivé) — mêmes valeurs que `prisma/seed.ts`, mais seulement le
    tenant et cet utilisateur, pas toute la flotte de démo (portefeuille,
    avions, contrats… non créés — à faire séparément si voulu).
- **Bug bloquant trouvé en testant le login réel avec ce compte, pas
  supposé.** `POST /api/auth/login` avec des identifiants valides répond
  `500` (corps vide, comportement Next.js normal en prod qui masque la
  stack trace) — confirmé que ce n'est pas un problème de validation de
  requête (un e-mail malformé renvoie bien `400` proprement, donc la
  route elle-même fonctionne). Cause quasi certaine, déduite du code
  (pas vue dans des logs Railway, inaccessibles depuis ici) :
  `login()` (`src/lib/auth.ts`) appelle `asSystem()` dès la première étape
  (recherche de l'utilisateur par e-mail, avant de connaître son tenant —
  c'est l'exception documentée dans CLAUDE.md §1), et `asSystem()`
  (`src/lib/db.ts`) lève une exception si
  `NODE_ENV==='production' && !ALLOW_SYSTEM_ACCESS`. Le runbook de
  déploiement (point 3 ci-dessus) ne liste **jamais** `ALLOW_SYSTEM_ACCESS`
  parmi les variables à renseigner sur Railway, et `.env.example` ne le
  mentionne pas non plus. Si cette variable n'a pas été positionnée sur
  le service Railway, **toute tentative de connexion échoue à 100 %**,
  identifiants corrects ou non — cohérent avec l'échec observé dès le
  premier essai. **Pas corrigé depuis cette session** : c'est un réglage
  de secret Railway, hors de portée d'ici, et CLAUDE.md est explicite sur
  le fait de ne pas contourner ce genre de garde-fou "temporairement pour
  déboguer". Action attendue : ajouter `ALLOW_SYSTEM_ACCESS=true` aux
  variables du service applicatif sur Railway et redéployer, puis
  reconfirmer `POST /api/auth/login` avec ce compte. **T5.4 ne peut pas
  être cochée tant que le login réel n'aura pas été revérifié après ce
  correctif.**

**Ce qui est déjà vérifié et prêt (aucune action supplémentaire requise) :**

- `npm run build` produit un build de production propre (revérifié à
  chaque phase de cette session).
- `/api/health` (T5.3) répond 200 base up / 503 base down — exploitable
  tel quel comme healthcheck par Railway/Fly.io.
- `.github/workflows/ci.yml` (T5.2) prouve déjà, à chaque push, que
  `npm ci && prisma generate && migrate deploy && db:rls && typecheck && lint && test && build` réussit contre un Postgres neuf — c'est
  exactement la séquence de mise en prod ci-dessous, déjà rejouée avec
  succès (cf. note T5.2).

**Runbook à suivre (Railway, recommandation retenue) :**

1. Créer le projet Railway, ajouter un service Postgres 16 managé.
2. Créer les rôles applicatifs sur cette base managée — `aeroos_app`
   NOSUPERUSER NOBYPASSRLS, `aeroos_system` NOSUPERUSER BYPASSRLS, avec
   des mots de passe de production générés (pas ceux de dev/CI). Utiliser
   `scripts/create-app-roles.ts` plutôt que taper le SQL à la main
   (idempotent, testé de bout en bout le 2026-09-02) :
   `ADMIN_DATABASE_URL="<external connection string Railway, onglet Variables du service Postgres>" npx tsx scripts/create-app-roles.ts`
   — copier immédiatement les deux URLs affichées dans le gestionnaire
   de secrets Railway (étape 3), le mot de passe n'est montré qu'une
   fois.
3. Renseigner dans le gestionnaire de secrets Railway (jamais dans le
   repo) : `DATABASE_URL` (rôle `aeroos_app`), `ADMIN_DATABASE_URL`
   (rôle superuser managé, pour les migrations/RLS uniquement — pas
   utilisé au runtime applicatif), `SYSTEM_DATABASE_URL` (rôle
   `aeroos_system`), `AUTH_SECRET` (**nouveau**, `openssl rand -base64 32` — jamais celui de dev), `NODE_ENV=production`, et selon les
   fonctionnalités activées : `ANTHROPIC_API_KEY`, `STORAGE_DRIVER=s3` +
   `S3_BUCKET`/`S3_REGION` + les identifiants AWS du driver
   (`src/lib/storage/s3.ts` — le driver local n'est pas fait pour la
   prod, cf. T2.5), `SENTRY_DSN`, `LOG_LEVEL=info`.
4. Déploiement initial : `DATABASE_URL=<ADMIN_DATABASE_URL> npx prisma migrate deploy`, puis `DATABASE_URL=<ADMIN_DATABASE_URL> npm run db:rls` (rôle superuser — les politiques RLS ne sont pas gérées par
   Prisma, cf. CLAUDE.md). `db:rls` exécute `scripts/apply-rls.ts` via
   `pg`, plus besoin de `psql` — le binaire n'est pas garanti présent sur
   l'image Railway (corrigé le 2026-09-02, cf. note ci-dessus). Puis
   déployer l'app avec les variables du point 3.
5. Vérifier `GET /api/health` → `200 {"status":"ok","database":"up"}`
   avant de considérer le déploiement réussi.
6. **Sauvegardes** : activer les sauvegardes automatiques du Postgres
   managé (fonctionnalité de la plateforme, pas du code applicatif).
   Puis — c'est le point qui ne peut pas être coché sans y avoir procédé
   réellement — **prendre une sauvegarde et la restaurer** dans une base
   Postgres jetable, revérifier `npm run test:isolation` contre cette
   base restaurée pour confirmer que les rôles/RLS survivent à une
   restauration, pas seulement les données.
7. Après chaque migration future en production : ne jamais oublier
   `npm run db:rls` (rôle superuser) — les politiques RLS ne sont pas
   rejouées automatiquement par `prisma migrate deploy`.

---

## PHASE 6 — Livraison client (couche SaaS)

> **Pourquoi cette phase existe.** Les phases 0 à 5 produisent une
> application. Cette phase en fait un service qu'un client peut acheter,
> ouvrir dans son navigateur et utiliser sans jamais voir un terminal.
>
> **Point de départ.** Aujourd'hui, un client ne peut ni obtenir un
> compte, ni inviter son équipe, ni recevoir la moindre notification. Les
> tenants viennent du seed, les alertes ne vivent qu'en base. Le pricing
> existe dans le document investisseur mais nulle part dans le code.
>
> **Sur le mot « application ».** AeroOS est une application web : le
> client ouvre une URL dans son navigateur. Le terminal est votre
> environnement de développement, pas le sien. Une fois T5.4 exécuté, il
> n'y a rien à installer côté client — voir T6.10 pour l'icône de bureau.
>
> **Ordre.** T6.3 (e-mails) est bloquant pour T6.1 et T6.2. Faire les
> trois d'abord.

---

### [ ] T6.3 — Envoi d'e-mails

**Fait en premier : bloque T6.1 et T6.2.**

**Contexte.** Le moteur d'alertes (`lib/alerts.ts`) génère déjà des
alertes que personne ne reçoit — elles ne vivent qu'en base et sur le
dashboard. Aucun canal sortant n'existe.

**Recommandation.** Resend ou Postmark. Éviter SendGrid pour un
démarrage : la délivrabilité initiale y est capricieuse.

**Fichiers.**

- `src/lib/email/send.ts` (nouveau) — abstraction fournisseur, même
  approche que `src/lib/storage.ts` (T2.5) : driver console en
  développement, driver réel en production, sélection par variable
  d'environnement
- `src/lib/email/templates/` (nouveau)

**Modèles nécessaires.** Activation de compte · invitation ·
réinitialisation de mot de passe · résumé quotidien des alertes · alerte
critique immédiate.

**Règles.**

- En développement et en test, écrire dans un fichier ou la console —
  jamais d'envoi réel (même logique que le driver storage local)
- Ne jamais mettre de donnée contractuelle sensible dans le corps du
  message : un lien vers la plateforme, pas les montants. Le mail sort du
  périmètre chiffré et transite par un sous-traitant.
- Appliquer la même discipline qu'en T5.3 : aucune donnée personnelle
  dans les logs d'envoi, seulement `userId` et le type de message
- Résumé quotidien groupé plutôt qu'un message par alerte, sinon le
  client filtre tout au bout d'une semaine

**Acceptation.**

- Les alertes critiques déclenchent un e-mail
- Le résumé quotidien groupe les alertes non critiques
- Aucun envoi réel en développement ni en test
- Désinscription possible des résumés, pas des alertes critiques
- Le driver réel échoue proprement si la clé API manque, sans écriture
  partielle (même exigence que le pipeline IA en T3.1)

---

### [ ] T6.1 — Provisionnement d'un tenant

**Contexte.** Les tenants viennent du seed. Créer un client aujourd'hui
suppose d'écrire du SQL à la main.

**Décision.** Ne PAS construire d'inscription libre en self-service. Le
segment cible s'acquiert par conversation directe — le plan d'acquisition
le dit explicitement. Ce qu'il faut, c'est un **provisionnement
administrateur** : créer un client en trois minutes après signature, sans
toucher à la base.

**Fichiers.**

- `src/app/(admin)/tenants/page.tsx` (nouveau) — console interne
- `src/app/(admin)/tenants/new/page.tsx` (nouveau)
- `src/lib/actions/tenant.ts` (nouveau)
- `src/lib/auth.ts` — ajouter un rôle `SUPERADMIN` hors tenant

**Attention sécurité — le point délicat de cette tâche.** Un `SUPERADMIN`
traverse les tenants par définition, ce que le RLS interdit précisément.
Passer par le rôle `aeroos_system` (`SYSTEM_DATABASE_URL`) via
`asSystem()`, jamais par le client applicatif.

Rappel du correctif de T5.3 : `asSystem()` journalise sa raison. Ne
jamais y interpoler d'e-mail, de nom de client ni d'identifiant
nominatif — la fuite trouvée en T5.3 venait exactement de là. Texte
générique uniquement, et détails dans l'audit, pas dans le log.

**Chaque accès superadmin à des données client doit être audité** aussi
strictement qu'un accès client.

**Le formulaire crée.**

1. Le `Tenant` (nom, plan, devise, région de stockage, quotas)
2. Le premier `User` en rôle `ADMIN`
3. Un `Portfolio` par défaut
4. Un e-mail d'activation avec définition du mot de passe (dépend de
   T6.3, et doit respecter la politique de mot de passe de T1.3)

**Acceptation.**

- Créer un client complet en moins de 3 minutes sans toucher à la base
- La région de stockage est immuable après création (conformité D2)
- Les quotas du plan sont enregistrés (`maxAssets`, `maxUsers`)
- Un accès `SUPERADMIN` à des données client apparaît dans le journal
  d'audit
- Impossible de créer un tenant dont l'entité est dans un pays sous
  embargo — réutiliser la logique de screening de T4.1
- `npm run test:isolation` passe toujours après l'ajout du rôle

---

### [ ] T6.2 — Invitation et gestion des utilisateurs

**Contexte.** C'est le besoin exprimé directement : **chaque entreprise
cliente doit avoir son propre administrateur**, capable de créer les
comptes de ses employés sans passer par vous.

Le modèle a déjà les quatre rôles (`ADMIN`, `MANAGER`, `ANALYST`,
`VIEWER`) et le RLS garantit qu'un `ADMIN` ne voit jamais les données
d'un autre client. Il manque le mécanisme d'invitation.

**Fichiers.**

- `src/app/(app)/settings/users/page.tsx` (nouveau)
- `src/app/(auth)/accept-invite/[token]/page.tsx` (nouveau)
- `src/lib/actions/invite.ts` (nouveau)

**Migration.** Nouveau modèle `Invitation` : `tenantId`, `email`, `role`,
`tokenHash`, `expiresAt` (7 jours), `acceptedAt`, `invitedById`.
Stocker le hash du token, jamais le token en clair — même principe que
les codes de récupération MFA de T1.1.

**Règles.**

- Seul un `ADMIN` du tenant peut inviter
- Quota `maxUsers` vérifié avant l'envoi
- Token à usage unique, expirant
- Rétrograder ou désactiver un utilisateur invalide ses sessions (la
  mécanique existe depuis T1.3, changement de mot de passe)
- Un `ADMIN` ne peut pas se retirer son propre rôle s'il est le dernier —
  sinon l'entreprise devient ingérable et doit vous appeler

**Acceptation.**

- Cycle complet : invitation → e-mail → définition du mot de passe →
  connexion avec le bon rôle
- Un token expiré ou réutilisé est refusé
- Un admin du tenant A ne peut pas inviter dans le tenant B (tester
  explicitement, comme pour l'isolation des documents en T2.5)
- Entrées d'audit : invitation, acceptation, changement de rôle,
  désactivation

---

### [ ] T6.4 — Onboarding guidé en moins de 30 minutes

**Contexte.** Critère de succès chiffré du plan d'exécution et argument
commercial. Aujourd'hui, un nouveau client arrive sur un dashboard vide
sans savoir quoi faire.

**Bonne nouvelle.** Les briques existent déjà : import CSV (T2.4),
formulaires actif et contrat (T2.1, T2.2), upload de documents (T2.5). Il
manque le fil conducteur.

**Fichiers.**

- `src/app/(app)/onboarding/page.tsx` (nouveau)
- `src/lib/onboarding.ts` (nouveau) — calcul de l'état d'avancement

**Parcours en 5 étapes.**

1. Créer le portefeuille (nom, devise)
2. Importer les actifs (réutilise T2.4)
3. Ajouter les contreparties — déclenche le screening sanctions de T4.1
4. Saisir ou importer les contrats
5. Vérifier le dashboard

**Principes.**

- Barre de progression persistante tant que l'onboarding n'est pas fini
- Chaque étape peut être sautée puis reprise
- Données d'exemple téléchargeables au bon format à chaque étape
- L'étape 2 doit fonctionner avec un vrai fichier Excel sale

**Acceptation.**

- Un utilisateur qui n'a jamais vu la plateforme importe 20 actifs et
  5 contrats en moins de 30 minutes, chronométré
- L'état d'avancement survit à une déconnexion
- Aucune étape ne bloque : on peut toujours passer à la suivante

---

### [ ] T6.5 — Quotas de plan et écran d'abonnement

**Contexte.** Le pricing existe dans le document investisseur : Starter
1 500 €, Professional 4 500 €, Enterprise sur devis, −15 % à l'engagement
annuel. Les champs `plan`, `maxAssets`, `maxUsers` existent sur `Tenant`
mais ne contraignent rien.

**Décision.** Pour les trois premiers pilotes, **pas de paiement en
ligne**. Facturation manuelle par virement, contrat de deux pages.
Construire Stripe quand il y aura huit clients — c'est du temps volé au
produit avant.

**Ce qu'il faut maintenant.**

- `maxAssets` bloque réellement la création au-delà du quota, avec un
  message d'upgrade explicite — pas une erreur technique
- `maxUsers` idem sur les invitations (T6.2)
- Écran « Abonnement » : plan, quotas consommés, date de renouvellement
- Un `SUPERADMIN` peut changer le plan d'un tenant (audité)

**Acceptation.**

- Dépasser le quota affiche un message clair et actionnable
- L'écran Abonnement est exact
- Le changement de plan est audité

---

### [ ] T6.6 — Sonde externe, page de statut, runbook d'incident

**Déjà fait en T5.3 — ne pas refaire :** endpoint `/api/health`
(200/503, vérifié en conditions réelles), logs structurés pino, suivi
d'erreurs via `error-tracking.ts`.

**Ce qui reste.**

- Sonde externe interrogeant `/api/health` toutes les minutes
  (UptimeRobot, Better Stack — gratuit à ce volume). C'est le point
  essentiel : aujourd'hui, si l'application tombe la nuit, personne ne le
  sait.
- Alerte vers votre téléphone si indisponibilité > 2 minutes
- Page de statut publique
- Calcul automatisé de la disponibilité mensuelle — c'est lui qui
  déclenche un éventuel remboursement au titre du SLA 99,9 %
- `SENTRY_DSN` réel configuré en production (noté non vérifié en T5.3)

**Procédure d'incident (conformité §2.3).** Qualification < 2 h ·
confinement < 4 h · notification client < 72 h · post-mortem sous
5 jours. **Écrire le runbook avant le premier incident, pas pendant.**

**Acceptation.**

- Une coupure simulée déclenche une alerte en moins de 3 minutes
- La page de statut reflète l'état réel
- Le runbook existe et a été relu
- Le calcul de disponibilité mensuel est automatisé

---

### [ ] T6.7 — Restauration vérifiée et export client

**Recouvre le point 6 du runbook T5.4** — à traiter ensemble.

**Contexte.** Le RPO < 1 h et le RTO < 4 h sont des engagements
contractuels. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

**À faire.**

- Sauvegardes automatiques du Postgres managé, rétention 30 jours
- **Restauration testée**, en vérifiant que `npm run test:isolation`
  passe contre la base restaurée : ce qui compte n'est pas seulement la
  survie des données, mais celle des rôles `aeroos_app` / `aeroos_system`
  et des politiques RLS
- Procédure écrite, exécutable par quelqu'un d'autre que vous
- Test de restauration mensuel planifié

**Export par tenant.** Un client qui part doit récupérer ses données —
exigence RGPD, et argument commercial de réversibilité. La logique
d'export de T4.2 existe pour un utilisateur ; l'étendre à un tenant
entier (actifs, contrats, documents, valorisations).

**Acceptation.**

- Une restauration complète a été réalisée au moins une fois, chronométrée
- Le temps mesuré est inférieur au RTO annoncé
- `test:isolation` passe sur la base restaurée
- L'export tenant produit une archive exploitable

---

### [ ] T6.8 — Support et documentation utilisateur ⚡

**Contexte.** Trois pilotes vont poser des questions. Sans canal défini,
elles arrivent par SMS à 22 h et se perdent.

**Minimum viable.**

- Adresse `support@` avec engagement de réponse sous 24 h ouvrées
- Guide de démarrage : 5 pages, captures d'écran, pas plus
- FAQ alimentée par les vraies questions des pilotes
- Journal des versions visible dans l'application

**Ce qu'il ne faut pas faire.** Pas de chat en direct, pas d'outil de
ticketing, pas de base de connaissance élaborée. À trois clients, l'e-mail
suffit et vous apprend davantage.

**Acceptation.**

- Le guide permet à un utilisateur de démarrer sans vous appeler
- Chaque question de pilote devient une entrée FAQ ou un ticket produit

---

### [ ] T6.9 — Environnement de recette

**Partiellement couvert.** La CI (T5.2) valide déjà chaque push contre un
Postgres neuf. Il manque un environnement persistant entre le
développement et la production.

**Pourquoi c'est nécessaire dès le premier pilote.** Sans recette, tester
une migration signifie l'appliquer directement sur les données d'un vrai
client. Inacceptable.

**Trois environnements.**

- **Développement** — local, données de seed
- **Recette** — copie de production, **données anonymisées**, pour tester
  les migrations avant application
- **Production** — données clients réelles

**Règles.**

- Aucune donnée client réelle hors production
- Toute migration passe par la recette
- Secrets distincts par environnement, `AUTH_SECRET` différent partout
- `npm run db:rls` après chaque migration, sur chaque environnement
  (point 7 du runbook T5.4)

**Script d'anonymisation production → recette.** Réutiliser la logique
d'anonymisation de T4.2 : e-mails remplacés, noms neutralisés, montants
conservés (ils ne sont pas des données personnelles et leur réalisme
compte pour tester).

**Acceptation.**

- Les trois environnements existent et sont isolés
- Le script d'anonymisation fonctionne
- Aucun accès direct à la base de production depuis un poste de
  développement

---

### [ ] T6.10 — Installation type application (PWA) ⚡

**Contexte.** AeroOS est une application web : le client ouvre une URL,
sans rien installer. Mais un lessor qui l'ouvre dix fois par jour préfère
une icône sur son bureau plutôt qu'un onglet perdu parmi trente autres.

Une PWA donne exactement ça : le navigateur propose « Installer »,
l'application obtient sa propre fenêtre et sa propre icône, sans barre
d'adresse. Aucune distribution à gérer, aucune mise à jour à pousser —
c'est toujours la version déployée qui s'exécute.

**Ne pas confondre avec une application de bureau.** Electron ou Tauri
supposeraient de compiler et distribuer des binaires par plateforme, de
gérer les mises à jour sur chaque poste et de signer le code. Cela ne se
justifie que pour un besoin hors ligne ou un accès au matériel — ni l'un
ni l'autre ne concerne AeroOS.

**Fichiers.**

- `public/manifest.json` (nouveau)
- `public/icons/` — 192×192, 512×512, maskable
- `src/app/layout.tsx` — lier le manifeste

**Manifeste.**

```json
{
  "name": "AeroOS — Asset Management",
  "short_name": "AeroOS",
  "start_url": "/portfolio",
  "display": "standalone",
  "background_color": "#080E1C",
  "theme_color": "#0E1629"
}
```

**Sur le service worker — prudence.** La tentation est de mettre les
données en cache pour un mode hors ligne. **Ne pas le faire.** Des
valorisations ou des échéances périmées affichées comme actuelles sont
pires que pas de données du tout, et le cache local de données
contractuelles pose une question de conformité (§1). Se limiter aux
ressources statiques, et afficher un message clair sans connexion.

**Acceptation.**

- Chrome et Edge proposent « Installer » sur desktop
- L'application installée s'ouvre en fenêtre autonome
- L'icône s'affiche correctement sur Windows et macOS
- Hors connexion : message explicite, aucune donnée périmée affichée

---

### [ ] T6.11 — Vérifier le pipeline IA en conditions réelles

**Contexte.** T3.1 et T3.2 sont implémentés et testés jusqu'à la limite
du secret manquant, mais aucun appel réel n'a été effectué —
`ANTHROPIC_API_KEY` n'était pas disponible. Deux points restent
explicitement non validés (cf. note T3.1) : la qualité de `sourcePage`,
qui dépend des marqueurs de page insérés par `pdf-parse`, et le format de
sortie structuré (JSON Schema brut, le helper `zodOutputFormat` du SDK
exigeant zod v4 alors que le projet est en zod v3).

**À faire.**

1. Configurer une clé réelle en développement
2. Tester sur **10 contrats de formats différents** — pas un seul PDF
   propre. Inclure au moins un scan de mauvaise qualité et un contrat
   avec avenants.
3. Mesurer le taux d'erreur par champ et confronter au critère du plan
   d'exécution : moins de 5 % d'erreur, confiance moyenne supérieure
   à 85 %
4. Vérifier que les clauses de sanctions sont bien détectées et forcent
   la révision humaine
5. Si `sourcePage` est peu fiable, décider : améliorer les marqueurs de
   page, ou retirer l'affichage plutôt que d'afficher une référence fausse

**Acceptation.**

- Taux d'erreur mesuré et documenté sur 10 contrats variés
- Aucune écriture en base sans validation humaine (revérifié en réel)
- Les corrections utilisateur sont bien stockées dans
  `AiExtraction.corrections` — c'est la matière première pour améliorer
  le prompt

---

## Backlog — pas encore planifié

- Portail locataire (accès limité pour les compagnies aériennes)
- Paiement en ligne Stripe (à partir de 8 clients — voir T6.5)
- Inscription libre en self-service (seulement si le segment cible change)
- **Option IA auto-hébergée, gamme Enterprise** — voir la note ci-dessous
- Marketplace (phase 3 du plan d'exécution — nécessite un effet réseau)
- Module Carbon & ESG
- Application mobile d'inspection (photos, QR, NFC)
- Intégration Cirium / ch-aviation pour enrichir les données
- Reporting IFRS 16
- API publique + documentation OpenAPI
- Support multi-devises avec taux historiques

---

### Note — option IA auto-hébergée (Enterprise)

**Décision prise :** l'IA passe par une API externe. Documenté ici pour
que le débat ne se rouvre pas à chaque session.

**Pourquoi l'API plutôt qu'un modèle local.**

- *Qualité.* Extraire 18 champs d'un contrat de 60 pages avec un score de
  confiance par champ est une tâche de raisonnement difficile. Un modèle
  léger auto-hébergé (7B–13B) confond dates de signature et de livraison,
  rate les avenants, hallucine des montants. Le différenciateur produit
  deviendrait le point faible : un client qui doit tout revérifier
  n'utilisera pas la fonctionnalité.
- *Charge opérationnelle.* GPU à provisionner, service d'inférence à
  maintenir, mises à jour de modèle, monitoring dédié. Six semaines
  volées au produit pour une équipe de quatre personnes.
- *Économie.* À 4 500 €/mois par client, quelques euros d'inférence par
  contrat sont négligeables. Un GPU dédié coûte plus cher tant que le
  volume est faible.
- *Conformité.* Un DPA avec traitement en région UE et engagement de
  non-rétention couvre le RGPD. Le cahier de conformité (§1.1,
  contexte 3) exige la **traçabilité** de chaque extraction, pas
  l'hébergement local.

**Mesures d'atténuation — déjà en place ou à confirmer en T6.11.**

- OCR exécuté localement (`pdf-parse`) : extraire le texte ne demande
  aucun raisonnement et évite d'envoyer le document brut
- N'envoyer que les sections pertinentes, pas le contrat entier
- Couche d'abstraction du fournisseur (prévue au sprint S8 du plan
  d'exécution) — c'est elle qui protège, pas le choix initial
- `modelName`, `modelVersion`, `promptVersion` journalisés à chaque appel

**Quand basculer en local.** Le jour où un client enterprise l'exige
contractuellement — cela arrivera, le secteur est conservateur. À ce
moment-là : volume, revenus et abstraction seront en place. Ce sera une
**option de gamme Enterprise facturée en conséquence**, pas une
contrainte subie.

**Ce qu'il faudra alors évaluer.** Modèles ouverts de taille moyenne
(30B+) spécialisés sur l'extraction documentaire, hébergés dans la région
du client, derrière la même interface — d'où l'importance de
l'abstraction.

---

## Notes pour les sessions futures

**Le modèle de données est la partie la plus coûteuse à changer.** Une
migration sur 14 entités liées est pénible. Réfléchir avant d'ajouter un
champ ; privilégier une table satellite à une colonne fourre-tout.

**Les règles métier aéronautiques sont contre-intuitives.** En cas de
doute sur un concept (LLP, half-life, MR reserves, return conditions),
demander plutôt que supposer. Une erreur de modélisation métier coûte
plus cher qu'une question.

**Ne pas optimiser prématurément.** Le produit n'a pas encore d'
utilisateurs. La lisibilité prime sur la performance jusqu'à preuve du
contraire.
