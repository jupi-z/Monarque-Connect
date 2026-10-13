# 73 — Phase 5 Sales — Pre-closure Evidence

## Périmètre vérifié

Cette preuve couvre le parcours `Quote → SalesOrder → Invoice →
PaymentRecord`, sans déduction réglementaire et sans exécution de paiement
externe. Les règles normatives restent celles de
[`71_PHASE5_SALES_EXECUTION_SPEC.md`](71_PHASE5_SALES_EXECUTION_SPEC.md).

La dernière baseline fonctionnelle intégrée avant cette tranche est
`main@20c04a31045987e4def69689782bed6b84b4ab56`. Les livraisons ont été
réalisées par PR dédiées :

- [PR #67 — Quote aggregate](https://github.com/jupi-z/Monarque-Connect/pull/67) ;
- [PR #68 — Quote coverage](https://github.com/jupi-z/Monarque-Connect/pull/68) ;
- [PR #69 — Sales Orders](https://github.com/jupi-z/Monarque-Connect/pull/69) ;
- [PR #70 — statut documentaire Orders](https://github.com/jupi-z/Monarque-Connect/pull/70) ;
- [PR #71 — Invoices](https://github.com/jupi-z/Monarque-Connect/pull/71) ;
- [PR #72 — PaymentRecords](https://github.com/jupi-z/Monarque-Connect/pull/72).

## Contrôles reproductibles

Les commandes suivantes sont les gates de cette tranche et sont exécutées
dans la CI avec PostgreSQL réel :

```text
npm run prisma:validate
npm run prisma:phase2:migration-proof
npm run prisma:phase3:migration-proof
npm run prisma:phase5:migration-proof
npm run prisma:deploy
npm run openapi:validate
npm run contracts:validate
npm test
npm run build
npm run test:e2e
```

`prisma:phase5:migration-proof` reconstruit une base vide avec toutes les
migrations puis applique la chaîne Phase 5 sur une base reconstruite depuis
la dernière migration Phase 4. Il vérifie aussi les colonnes structurelles
des sources et statuts Sales.

`tests/e2e/phase5-sales.e2e.test.ts` vérifie le parcours complet jusqu'au
paiement total, l'immutabilité des snapshots, le refus cross-tenant, le scope
d'établissement sélectionné et le refus lorsque l'entitlement `SALES` est
absent.

## État de cette preuve

Ce document décrit les contrôles à exécuter par la PR de clôture. Il ne fige
pas le SHA final de `main` : le commit de fusion de cette PR et sa CI post-
merge sont les références GitHub faisant foi.

## Vérification finale

Vérification effectuée le 13/10/2026 après fusion de la PR #73 :

- commit final de livraison sur `main` :
  `921d329a7c19e64b5f054a49c1d9c6fee7b8d2ba` ;
- CI de la PR #73 :
  [Backend CI #210](https://github.com/jupi-z/Monarque-Connect/actions/runs/38409251058),
  conclusion `success` ;
- CI post-merge déclenchée par `push` sur `main` :
  [Backend CI #211](https://github.com/jupi-z/Monarque-Connect/actions/runs/38409757868),
  conclusion `success`, avec 42 fichiers de tests et 156 tests réussis ;
- checkout local vérifié sur `main` : HEAD et `origin/main` identiques au SHA
  ci-dessus, arbre de travail propre ;
- branches résiduelles vérifiées : uniquement `main` côté local et `origin/main`
  côté distant.

La Phase 5 est donc clôturée techniquement à 100 %. Cette décision ne vaut
pas déclaration de préparation à la production publique et ne tranche aucune
obligation fiscale, réglementaire ou de paiement propre à une juridiction.
