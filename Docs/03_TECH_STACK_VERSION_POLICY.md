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

## Politique IA / analytique

- aucun fournisseur/modèle IA n'est une dépendance du Core ;
- aucun SDK fournisseur dans les modules métier ;
- l'intégration IA future passe par un adapter `ai-gateway` ;
- PostgreSQL + outbox suffisent au MVP pour Event Fabric ;
- aucun vector database imposé avant besoin mesuré ;
- aucun framework agentique imposé dans le socle ;
- embeddings, model provider et runtime agentique sont des choix remplaçables ;
- toute dépendance IA majeure exige revue sécurité, données, licence, coût et ADR.
