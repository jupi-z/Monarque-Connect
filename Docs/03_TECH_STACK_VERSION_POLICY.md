# 03 — Stack et versions

## Baseline
- Node.js `>=24 <25`
- TypeScript `strict`
- NestJS `12.x`
- PostgreSQL `17.x`
- Prisma `7.x`
- OpenAPI `3.1`
- S3-compatible object storage
- Argon2id
- JOSE/JWT RS256 ou EdDSA avec `kid`
- Vitest
- Supertest
- Docker

## Politique
- versions majeures figées pour un cycle de release ;
- upgrades majeurs via ADR ;
- lockfile obligatoire ;
- dépendances minimales ;
- aucun framework ERP/CRM tiers comme socle métier ;
- ERPNext et Frappe sont explicitement hors architecture cible ;
- pas de Redis tant qu'un besoin mesuré ne le justifie ;
- pas de broker distribué en MVP.

## Compatibilité
Le backend est la référence. Les clients sont compatibles avec une version API, jamais avec des classes internes.
