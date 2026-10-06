# 51 — Registre des exceptions et revues sécurité dépendances

## Principe

Une alerte de dépendance ne peut être ignorée silencieusement. Toute exception doit être :
- identifiée ;
- reliée à son chemin de dépendance ;
- classée runtime ou tooling ;
- accompagnée de mitigations ;
- revue avant release commerciale et lors des upgrades concernés.

## SEC-DEP-001 — Prisma CLI 7.10.0 / dépendances de tooling

### Détection

Le contrôle `npm audit` signale actuellement des vulnérabilités de sévérité élevée dans :
- `deepmerge-ts < 8.0.0` via `@prisma/config` ;
- `mysql2 <= 3.23.0` via le package CLI `prisma`.

### Portée vérifiée

Le package `prisma` est une **devDependency** du dépôt.

Le graphe runtime racine utilise :
- `@prisma/client` ;
- `@prisma/adapter-pg` ;
- PostgreSQL/`pg`.

`@prisma/config`, `mysql2` et `deepmerge-ts` ne sont pas atteignables depuis les dépendances de production racines dans le lockfile courant.

### Décision

Ne pas appliquer `npm audit fix --force` : la correction proposée par npm impose un downgrade majeur de Prisma et constitue un changement architectural non justifié.

### Mitigations

- le CLI Prisma reste tooling développement/CI ;
- l'image de production future installe uniquement les dépendances nécessaires au runtime ;
- `scripts/check-runtime-audit.mjs` reconstruit le graphe des dépendances runtime à partir du lockfile ;
- toute vulnérabilité HIGH/CRITICAL atteignable depuis le runtime fait échouer la CI ;
- les advisories tooling restent visibles et doivent être réévalués à chaque upgrade Prisma.

### Sortie de l'exception

Cette exception est fermée dès qu'une version Prisma compatible supprime les dépendances vulnérables, ou avant release commerciale si l'analyse de portée change.

## Règle

Aucune exception ne peut couvrir :
- un secret exposé ;
- une vulnérabilité runtime critique connue sans mitigation ;
- une violation d'isolation tenant ;
- un contournement d'autorisation ;
- une perte d'intégrité financière/stock/caisse.
