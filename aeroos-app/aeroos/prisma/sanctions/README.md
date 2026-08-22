# Liste de sanctions — données d'exemple

`sdn-sample.csv` contient des noms **entièrement fictifs** (suffixe
`(SAMPLE)`) au format attendu par `scripts/import-sanctions-list.ts` —
utile pour tester le screening sans dépendre d'un fichier externe.

**Avant toute mise en production**, remplacer ce fichier par un export
réel de la liste SDN de l'OFAC (https://sanctionslist.ofac.treas.gov/)
au format CSV avec au minimum une colonne `name`, une colonne optionnelle
`program`, et exécuter :

```bash
npm run sanctions:import -- prisma/sanctions/<fichier-reel>.csv "<date-de-la-liste YYYY-MM-DD>"
```

Le screening (`src/lib/compliance/sanctions.ts`) ne vaut que ce que vaut
la liste importée — ce fichier d'exemple ne doit jamais servir de
référence réglementaire.
