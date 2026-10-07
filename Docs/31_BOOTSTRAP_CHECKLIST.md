# 31 — Checklist de bootstrap

## Socle technique avant Phase 0.5

- [x] dépôt privé créé ;
- [x] `@Gabby344` a accepté l'invitation collaborateur ;
- [x] Node 24 / lockfile reproductible ;
- [x] `npm ci` utilisé en CI ;
- [x] configuration runtime validée fail-fast ;
- [x] PostgreSQL 17 démarre en CI ;
- [x] schéma Prisma validé ;
- [x] Prisma Client générable ;
- [x] lint vert avec toolchain ESLint supportée ;
- [x] typecheck vert ;
- [x] tests unitaires verts ;
- [x] build vert ;
- [x] OpenAPI validée ;
- [x] contrats machine-readable validés ;
- [x] audit HIGH/CRITICAL du graphe runtime sans vulnérabilité atteignable ;
- [x] `/api/v1/health/live` vérifié par HTTP ;
- [x] `/api/v1/health/ready` vérifie réellement PostgreSQL ;
- [x] CI GitHub verte sur la baseline auditée.

## Hardening GitHub

- [ ] protection technique de `main` activée — suivi dans l'issue `#6`.

Le dépôt privé courant expose `main` comme non protégée. Tant que `#6` n'est pas résolue, la règle opérationnelle est : branche + PR + CI verte + revue `@jupi-z`, aucun push direct sur `main`.

## Décision de lancement

Le **socle technique est prêt et la Phase 0.5 Event Fabric est terminée sur `main`** (`#13`). Les preuves et commandes sont consignées dans `Docs/53_PHASE_0_5_STATUS.md`. La protection technique de branche reste un hardening de gouvernance externe au code ; tant qu'elle n'est pas disponible, toute contribution passe par branche, PR, CI verte et revue.
