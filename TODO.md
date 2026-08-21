# TODO — AeroOS

Feuille de route d'implémentation. Chaque tâche est autonome : contexte,
fichiers concernés, étapes, critères d'acceptation.

**Convention :** cocher `[x]` une fois les critères d'acceptation vérifiés.
Ne jamais cocher une tâche dont le `typecheck` ou le `build` échoue.

**Ordre :** les phases sont séquentielles. À l'intérieur d'une phase, les
tâches marquées ⚡ peuvent être faites en parallèle.

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
   directement mais retourner `{ success: false, mfaRequired: true,
   challengeToken }` où `challengeToken` est un JWT court (5 min) portant
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

### [ ] T1.3 — Politique de mot de passe et changement ⚡

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

### [ ] T1.4 — Renouvellement de session

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

### [ ] T2.1 — Formulaire de création/édition d'actif

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

### [ ] T2.2 — Formulaire de contrat + rattachement moteurs

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

### [ ] T2.3 — Enregistrement des paiements ⚡

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

### [ ] T2.4 — Import CSV/Excel

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

### [ ] T2.5 — Upload de documents

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

### [ ] T2.6 — Recherche full-text ⚡

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

### [ ] T3.1 — Pipeline d'extraction de contrat

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

---

### [ ] T3.2 — Validation et écriture des extractions

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

### [ ] T3.3 — Résumé de rapport technique ⚡

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

---

## PHASE 4 — Conformité opérationnelle

### [ ] T4.1 — Screening des sanctions

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

---

### [ ] T4.2 — Export et effacement RGPD ⚡

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

---

### [ ] T4.3 — Purge automatique selon les durées de rétention ⚡

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

---

## PHASE 5 — Préparation à la production

### [ ] T5.1 — Tests automatisés

**Priorité de couverture :**
1. `lib/valuation.ts` — cas limites : avion très ancien, heures nulles,
   type inconnu
2. `lib/alerts.ts` — chaque règle, et l'idempotence
3. Isolation tenant — déjà couverte par `test:isolation`, à intégrer
4. Import CSV — données sales

**Outil.** `vitest` (léger, compatible TS natif).

**Acceptation.** `npm test` passe, couverture > 60 % sur `src/lib/`.

---

### [ ] T5.2 — Intégration continue ⚡

**Fichier.** `.github/workflows/ci.yml`

**Étapes.** install → typecheck → lint → test → build, avec un service
Postgres pour les tests d'intégration.

**Acceptation.** La CI échoue si le typecheck ou les tests échouent.

---

### [ ] T5.3 — Journalisation et surveillance ⚡

- Logs structurés en JSON (`pino`)
- Aucune donnée personnelle dans les logs (conformité §7 D4)
- Endpoint `/api/health` vérifiant la connexion base
- Suivi des erreurs (Sentry ou équivalent)

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

---

## Backlog — pas encore planifié

- Portail locataire (accès limité pour les compagnies aériennes)
- Marketplace (phase 3 du plan d'exécution — nécessite un effet réseau)
- Module Carbon & ESG
- Application mobile d'inspection (photos, QR, NFC)
- Intégration Cirium / ch-aviation pour enrichir les données
- Reporting IFRS 16
- API publique + documentation OpenAPI
- Support multi-devises avec taux historiques

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
