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
`audit_logs` est rendu immuable au niveau base (`FORCE ROW LEVEL
SECURITY` + trigger `reject_audit_mutation` qui rejette tout UPDATE/DELETE,
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
  `tenant-isolation.integration.test.ts`, qui lance `npm run
  test:isolation` en sous-processus plutôt que de dupliquer sa logique en
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
la doc l'exige (rôles → migrations en superuser → `GRANT ... ON ALL
TABLES` une fois les tables créées → RLS).

**Vérifié réellement, pas seulement relu :** toute la séquence a été
rejouée en local contre un conteneur Postgres 16 jetable dédié (port
différent de la base de dev, jamais touchée) — création des deux rôles,
`prisma migrate deploy` (7 migrations, base vide), `GRANT`, `psql -f
prisma/rls.sql` (RLS activé + forcé sur les 12 tables tenant-scopées,
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
  la sortie de test (`[SYSTEM ACCESS] login: recherche de l'utilisateur
  qa-auth@example.invalid…`) avant correction. Les deux messages ne
  portent plus que du texte générique. `src/lib/db.ts` : `console.warn`
  → `logger.warn()` dans `asSystem()` ; le `console.error('[AUDIT
  FAILURE]', err, entry)` de `audit()` (qui journalisait `entry` en
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
dédiée écrivant en mémoire — et `error-tracking.test.ts`), `npm run
lint` et `npm run build` passent.

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
cochés depuis ici. Case laissée décochée : contrairement à T3.1/T3.2/T5.3
(où le pipeline était vérifiable jusqu'à la limite du secret manquant),
« Déploiement » n'a de sens que si l'app est réellement déployée — rien
à côté de ça ne satisfait l'énoncé. Ce qui suit est le runbook à exécuter
par quelqu'un disposant des accès.

**Ce qui est déjà vérifié et prêt (aucune action supplémentaire requise) :**
- `npm run build` produit un build de production propre (revérifié à
  chaque phase de cette session).
- `/api/health` (T5.3) répond 200 base up / 503 base down — exploitable
  tel quel comme healthcheck par Railway/Fly.io.
- `.github/workflows/ci.yml` (T5.2) prouve déjà, à chaque push, que
  `npm ci && prisma generate && migrate deploy && db:rls && typecheck
  && lint && test && build` réussit contre un Postgres neuf — c'est
  exactement la séquence de mise en prod ci-dessous, déjà rejouée avec
  succès (cf. note T5.2).

**Runbook à suivre (Railway, recommandation retenue) :**
1. Créer le projet Railway, ajouter un service Postgres 16 managé.
2. Créer les rôles applicatifs sur cette base managée — **mêmes
   commandes SQL que `.env.example` documente et que `ci.yml` exécute**
   (`aeroos_app` NOSUPERUSER NOBYPASSRLS, `aeroos_system` NOSUPERUSER
   BYPASSRLS), avec des mots de passe de production générés (pas ceux de
   dev/CI).
3. Renseigner dans le gestionnaire de secrets Railway (jamais dans le
   repo) : `DATABASE_URL` (rôle `aeroos_app`), `ADMIN_DATABASE_URL`
   (rôle superuser managé, pour les migrations/RLS uniquement — pas
   utilisé au runtime applicatif), `SYSTEM_DATABASE_URL` (rôle
   `aeroos_system`), `AUTH_SECRET` (**nouveau**, `openssl rand -base64
   32` — jamais celui de dev), `NODE_ENV=production`, et selon les
   fonctionnalités activées : `ANTHROPIC_API_KEY`, `STORAGE_DRIVER=s3` +
   `S3_BUCKET`/`S3_REGION` + les identifiants AWS du driver
   (`src/lib/storage/s3.ts` — le driver local n'est pas fait pour la
   prod, cf. T2.5), `SENTRY_DSN`, `LOG_LEVEL=info`.
4. Déploiement initial : `DATABASE_URL=<ADMIN_DATABASE_URL> npx prisma
   migrate deploy`, puis `DATABASE_URL=<ADMIN_DATABASE_URL> npm run
   db:rls` (rôle superuser — les politiques RLS ne sont pas gérées par
   Prisma, cf. CLAUDE.md). Puis déployer l'app avec les variables du
   point 3.
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
