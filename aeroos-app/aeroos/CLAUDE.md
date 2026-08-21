# CLAUDE.md — Contexte projet AeroOS

Ce fichier est lu automatiquement à chaque session Claude Code. Il contient ce
qu'il faut savoir avant de toucher au code.

---

## Ce qu'est ce projet

**AeroOS** — plateforme SaaS de gestion du cycle de vie des actifs
aéronautiques (avions, moteurs, composants) pour lessors indépendants de
5 à 50 appareils.

Modules : registre d'actifs, contrats de leasing, portfolio consolidé,
valorisation, documents, alertes, conformité.

**Stade actuel :** squelette fonctionnel. Le socle (données, sécurité,
moteurs métier) est solide. Les écrans sont en lecture seule — les
formulaires de création/édition restent à construire.

---

## Stack

- **Next.js 15** (App Router, Server Components par défaut)
- **TypeScript** strict
- **PostgreSQL 16** + **Prisma 5**
- **jose** (JWT) + **bcryptjs** — pas de NextAuth
- CSS vanilla avec variables — pas de Tailwind, pas de librairie UI

**Node.js ≥ 20 requis.**

---

## Règles non négociables

### 1. Toute requête base passe par `withTenant()`

```ts
// ✅ Correct
const fleet = await withTenant(session.tenantId, (tx) =>
  tx.aircraft.findMany({ where: { deletedAt: null } })
);

// ❌ Interdit — contourne le RLS Postgres
const fleet = await prisma.aircraft.findMany();
```

Seule exception légitime : `login()` dans `src/lib/auth.ts`, qui doit
chercher un utilisateur avant de connaître son tenant.

`asSystem()` existe pour les tâches multi-tenant, mais exige une raison
explicite et est désactivé en production sans variable d'environnement.

### 2. Jamais de suppression physique

Toutes les entités métier ont `deletedAt`. On met à jour ce champ, on ne
supprime pas la ligne. Toujours filtrer `where: { deletedAt: null }`.

### 3. Les valorisations ne sont pas des appraisals

Tout écran affichant une valeur calculée doit porter la mention non
certifiée (classe CSS `.disclaimer`). C'est une exigence réglementaire
documentée dans le cahier de conformité §4.3, pas une précaution de style.

### 4. L'IA propose, l'humain valide

Aucune donnée extraite automatiquement n'est écrite en base sans
validation explicite. Le modèle `AiExtraction` a un statut `PENDING` par
défaut. Confiance < 85 % → champ marqué à vérifier.

### 5. Actions sensibles → `audit()`

Création, modification, suppression, export, consultation de données
sensibles. Le journal d'audit est append-only et ne doit jamais être
modifié.

### 6. Pas de données personnelles dans les logs

Utiliser `userId` / `tenantId`, jamais l'e-mail ni le contenu d'un contrat.

---

## Conventions de code

**Langue :** interface et commentaires en français. Noms de variables,
fonctions et champs de base en anglais.

**Server Components par défaut.** `'use client'` uniquement quand il faut
de l'état ou un gestionnaire d'événement.

**Formatage d'affichage :** toujours passer par `src/lib/format.ts`. Ne
jamais formater une date ou un montant inline.

**Decimal Prisma :** les montants sont des `Decimal`. Convertir avec
`Number(x)` avant calcul ou affichage.

**Pages dynamiques :** ajouter `export const dynamic = 'force-dynamic'`
sur toute page lisant la base (sinon Next.js met en cache au build).

**CSS :** ajouter les classes dans `src/app/globals.css`. Styles inline
tolérés pour les cas ponctuels, pas pour les composants réutilisables.

---

## Structure

```
src/
├── app/
│   ├── (app)/          Application authentifiée
│   │   ├── layout.tsx  Shell + sidebar + garde de session
│   │   ├── portfolio/  Dashboard consolidé
│   │   ├── assets/     Registre + fiche actif ([id])
│   │   ├── contracts/  Contrats + paiements
│   │   ├── valuation/  Historique des valorisations
│   │   ├── documents/  Document vault
│   │   ├── ai/         Validation des extractions IA
│   │   └── audit/      Journal d'audit
│   ├── (auth)/login/
│   └── api/auth/
├── components/         Composants partagés (NavItem)
├── lib/
│   ├── db.ts           prisma, withTenant, asSystem, audit
│   ├── auth.ts         login, logout, getSession, requireSession, requireRole
│   ├── valuation.ts    calculateValuation, buildValueCurve
│   ├── alerts.ts       evaluateAlerts (8 règles)
│   └── format.ts       money, date, aircraftLabel, assetStatus…
└── middleware.ts

prisma/
├── schema.prisma       14 entités
├── rls.sql             Politiques Row Level Security
└── seed.ts             Jeu de démo (Meridian Aviation Capital)

scripts/
├── run-alerts.ts
├── refresh-valuations.ts
└── test-tenant-isolation.ts
```

---

## Commandes

```bash
npm run dev                  # serveur de dev
npm run typecheck            # vérification TypeScript
npm run build                # build production

npm run db:up                # PostgreSQL via Docker
npm run db:migrate           # migrations
npm run db:rls               # appliquer les politiques RLS
npm run db:seed              # données de démo
npm run db:reset             # réinitialisation complète
npm run db:studio            # explorateur Prisma

npm run alerts:run           # moteur d'alertes
npm run valuation:refresh    # recalcul des valorisations
npm run test:isolation       # test d'isolation multi-tenant
```

**Après toute modification de `schema.prisma` :**
`npm run db:migrate` puis `npm run db:rls` (les politiques RLS ne sont pas
gérées par Prisma — elles doivent être réappliquées).

---

## Compte de démonstration

`admin@meridian-aviation.com` / `demo1234`

Le seed crée un tenant « Meridian Aviation Capital » avec une flotte
fictive. Ne jamais y mettre de données réelles de clients.

---

## Avant de considérer une tâche terminée

1. `npm run typecheck` passe sans erreur
2. `npm run build` réussit
3. `npm run test:isolation` passe si la tâche touche à la base
4. La page se charge sans erreur console
5. Les actions sensibles écrivent dans le journal d'audit

---

## Où trouver les décisions déjà prises

Le dossier de conception (hors repo) contient :
- Document investisseur — vision, marché, modèle économique
- Plan d'exécution 18 mois — roadmap, jalons, recrutement
- Cahier de conformité — RGPD, sécurité, aviation, sanctions

Les décisions d'architecture de conformité (D1 à D5) sont déjà implémentées
dans le socle. Ne pas les défaire sans raison explicite.

---

## Ce qu'il ne faut pas faire

- Ne pas introduire de librairie UI (Tailwind, MUI, shadcn). Le CSS actuel
  est volontairement minimal et sans dépendance.
- Ne pas éclater en microservices. Le monolithe modulaire est un choix
  assumé pour ce stade.
- Ne pas ajouter d'ORM ou de query builder en parallèle de Prisma.
- Ne pas désactiver le RLS « temporairement pour déboguer ».
- Ne pas committer de `.env`, de clés, ni de données clients.
