# 15 — Stratégie de tests

## Pyramide
- unit : règles pures ;
- integration : PostgreSQL réel ;
- contract : OpenAPI ;
- E2E HTTP : use-cases ;
- security : RBAC/tenant/ownership ;
- concurrency : séquences, paiements, stock, invitations ;
- migration : base vide + upgrade ;
- performance : baseline staging.

## Base de données
Les tests critiques utilisent PostgreSQL réel, pas SQLite.

## E2E canonique
API uniquement :
1. register ;
2. create organization ;
3. invite second member ;
4. create party ;
5. create product ;
6. create lead/opportunity ;
7. quote → accepted ;
8. order → confirmed ;
9. invoice → issued ;
10. payment → paid ;
11. stock movement cohérent ;
12. publish network profile ;
13. second organization discovered ;
14. connection accepted ;
15. conversation + messages ;
16. tenant A tente accès privé tenant B → refus.

Aucune UI n'entre dans ce scénario.
