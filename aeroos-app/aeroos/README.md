# AeroOS

**Plateforme de gestion du cycle de vie des actifs aéronautiques.**

Registre d'actifs, gestion de contrats de leasing, valorisation, alertes et
conformité — dans un système unique, multi-tenant, conçu pour les lessors
indépendants de taille moyenne (5 à 50 appareils).

---

## Démarrage rapide

**Prérequis :** Node.js ≥ 20, Docker, npm.

```bash
# 1. Dépendances
npm install

# 2. Variables d'environnement
cp .env.example .env
# puis générer une clé de session :
#   openssl rand -base64 32
# et la coller dans AUTH_SECRET

# 3. Base de données + schéma + RLS + données de démo
npm run setup

# 4. Lancer
npm run dev
```

Application disponible sur **http://localhost:3000**

**Compte de démonstration :**
`admin@meridian-aviation.com` / `demo1234`

---

## Ce que fait la plateforme aujourd'hui

| Module                             | État | Description                                                                                                                    |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Registre d'actifs**        | ✅    | Avions, moteurs, composants. Fiche complète type « jumeau numérique » : identité, utilisation, navigabilité, historique. |
| **Leasing**                  | ✅    | Contrats, conditions financières, maintenance reserves, suivi des paiements.                                                  |
| **Portfolio**                | ✅    | KPIs consolidés, cash-flow, concentration par locataire, échéancier.                                                        |
| **Valorisation**             | ✅    | Moteur algorithmique : Base Value, Current Market Value, Residual Value.                                                       |
| **Alertes**                  | ✅    | 8 règles : expirations, impayés, assurances, maintenance, LLP, concentration, sanctions.                                     |
| **Conformité**              | ✅    | Isolation RLS, audit log immuable, soft delete, traçabilité qualité des données.                                           |
| **Documents**                | 🚧    | Modèle de données prêt, upload S3 à implémenter.                                                                          |
| **IA (extraction contrats)** | 🚧    | Champs de traçabilité en base, pipeline à construire.                                                                       |
| **MFA**                      | 🚧    | Champs en base, TOTP à brancher avant ouverture beta.                                                                         |

---

## Architecture

**Monolithe modulaire.** Un seul déploiement, découpé proprement en modules
internes. Ce choix est délibéré : les microservices spécifiés dans le dossier
d'architecture sont la cible à 200+ clients, pas le point de départ. Éclater
trop tôt coûte des semaines de plomberie avant le premier écran utile.

```
src/
├── app/
│   ├── (app)/          Application authentifiée (shell + pages)
│   │   ├── dashboard/  Portfolio consolidé
│   │   ├── assets/     Registre + fiche actif
│   │   └── contracts/  Contrats + paiements
│   ├── (auth)/login/   Authentification
│   └── api/auth/       Routes de session
├── components/         Composants partagés
├── lib/
│   ├── db.ts           Accès base + contexte tenant + audit
│   ├── auth.ts         Sessions JWT, rôles, mots de passe
│   ├── valuation.ts    Moteur de valorisation
│   ├── alerts.ts       Moteur de règles d'alertes
│   └── format.ts       Formatage d'affichage
└── middleware.ts       Protection des routes

prisma/
├── schema.prisma       Modèle de données (14 entités)
├── rls.sql             Politiques Row Level Security
└── seed.ts             Jeu de démonstration

scripts/
├── run-alerts.ts             Moteur d'alertes (cron quotidien)
├── refresh-valuations.ts     Recalcul mensuel des valeurs
└── test-tenant-isolation.ts  Test de sécurité multi-tenant
```

**Stack :** Next.js 15 (App Router) · TypeScript · PostgreSQL 16 · Prisma ·
JWT via `jose` · bcrypt.

---

## Sécurité multi-tenant — la règle absolue

L'isolation entre clients repose sur **deux couches indépendantes**. Si l'une
est oubliée, l'autre protège encore.

**1. Row Level Security PostgreSQL** (`prisma/rls.sql`)
La base refuse physiquement toute lecture hors du tenant courant.

**2. `withTenant()`** (`src/lib/db.ts`)
Chaque requête s'exécute dans une transaction où le contexte tenant est défini.

```ts
// ✅ Correct — toujours passer par withTenant
const fleet = await withTenant(session.tenantId, (tx) =>
  tx.aircraft.findMany({ where: { deletedAt: null } })
);

// ❌ Jamais — contourne le RLS
const fleet = await prisma.aircraft.findMany();
```

Vérification :

```bash
npm run test:isolation
```

---

## Décisions de conformité déjà intégrées

Ces choix viennent du cahier de conformité (§7) et sont **coûteux à ajouter
après coup** — c'est pourquoi ils sont dans le socle dès maintenant.

| Réf. | Décision                                                  | Où                               |
| ----- | ---------------------------------------------------------- | --------------------------------- |
| D1    | Isolation tenant par RLS Postgres                          | `prisma/rls.sql`, `lib/db.ts` |
| D2    | Région de stockage par tenant, immuable                   | `Tenant.storageRegion`          |
| D3    | Audit log append-only, jamais modifiable                   | `AuditLog`, `audit()`         |
| D4    | Pas de données personnelles dans les logs applicatifs     | `lib/db.ts`                     |
| D5    | Séparation données certifiées / déclarées / estimées | `DataQuality`                   |
| —    | Soft delete partout, aucune suppression physique           | `deletedAt`                     |
| §4.3 | Valorisations marquées non certifiées                    | `isCertified`, bandeau UI       |

---

## Commandes

```bash
npm run dev                  # serveur de développement
npm run build                # build de production
npm run typecheck            # vérification TypeScript

npm run db:up                # démarrer PostgreSQL (Docker)
npm run db:migrate           # appliquer les migrations
npm run db:rls               # (ré)appliquer les politiques RLS
npm run db:seed              # charger les données de démo
npm run db:studio            # explorateur de base Prisma
npm run db:reset             # réinitialiser complètement

npm run alerts:run           # exécuter le moteur d'alertes
npm run valuation:refresh    # recalculer les valorisations
npm run test:isolation       # tester l'isolation multi-tenant
```

---

## Prochaines étapes

**Avant l'ouverture aux premiers clients :**

1. **MFA (TOTP)** — obligatoire selon le cahier de conformité. Champs déjà en base.
2. **Upload de documents** — stockage S3 chiffré + indexation full-text.
3. **Import CSV/Excel** — l'onboarding doit tenir en moins de 30 minutes.
4. **Screening sanctions** — brancher une API (ComplyAdvantage, Refinitiv).
5. **Penetration test externe** — à commander 2 mois avant la beta.

**Ensuite :**

6. Extraction IA des contrats PDF (18 champs, validation humaine obligatoire).
7. Résumé IA des rapports techniques.
8. Module Documents complet (versioning, contrôle d'accès par rôle).

---

## Notes de développement

**Les valorisations ne sont pas des appraisals.** Le moteur produit des
estimations algorithmiques. Toute interface affichant une valeur doit porter
la mention correspondante — c'est une exigence réglementaire, pas une
précaution de style.

**Le seed est réaliste mais fictif.** Compagnies, MSN et immatriculations sont
inventés. Ne jamais utiliser de données réelles de clients dans un
environnement de démonstration.

**Le modèle de données est la partie la plus coûteuse à changer.** Les
migrations sur 14 entités liées sont pénibles. Réfléchir avant d'ajouter un
champ, et privilégier les tables satellites aux colonnes fourre-tout.
