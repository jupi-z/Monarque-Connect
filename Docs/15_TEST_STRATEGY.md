# 15 — Stratégie de tests

## Pyramide

- unit : règles pures, calcul d'entitlements, transitions ;
- integration : PostgreSQL réel ;
- contract : OpenAPI ;
- E2E HTTP : use-cases ;
- security : RBAC/tenant/establishment/entitlement/ownership ;
- concurrency : séquences, paiements, caisse, stock, quotas, invitations ;
- migration : base vide + upgrade ;
- performance : baseline staging.

## Matrices obligatoires

### Tenant isolation
Pour chaque ressource tenantée : A peut accéder, B ne peut pas accéder.

### Establishment isolation
Un membre scoped sur établissement A ne voit ni ne modifie les ressources établissement B.

### Entitlement
Pour chaque module :
1. plan autorise + module actif + permission → succès ;
2. plan n'autorise pas → refus ;
3. override DENY → refus ;
4. module autorisé mais désactivé → refus fonctionnel ;
5. entitlement retiré après session déjà ouverte → refus immédiat côté serveur.

### RBAC
Chaque rôle possède au moins un test positif et un test négatif par domaine critique.

## Base de données

Les tests critiques utilisent PostgreSQL réel, pas SQLite.

## E2E canonique API-only

1. register ;
2. create organization de type `COMMERCE_DISTRIBUTION` ;
3. établissement principal créé ;
4. plan `BUSINESS` assigné par plateforme ;
5. capabilities renvoie les modules attendus ;
6. invite second member scoped sur l'établissement principal ;
7. create customer et supplier ;
8. create product + warehouse ;
9. create lead/opportunity ;
10. quote → accepted ;
11. sales order → confirmed ;
12. invoice → issued ;
13. payment → paid ;
14. cash movement cohérent ;
15. supplier RFQ → purchase order → goods receipt ;
16. stock entrant/sortant cohérent ;
17. create project + task + expense liée ;
18. publish network profile ;
19. platform verifies organization and trust projection is visible ;
20. second organization discovered ;
21. connection accepted ;
22. network inquiry convertie en opportunity ;
23. conversation + messages ;
24. insight/KPI calculable ;
25. export tenant demandé puis généré sans secrets ;
26. user hors scope établissement → refus ;
27. tenant A tente accès privé tenant B → refus ;
28. platform retire `PURCHASES` → endpoint purchases refuse immédiatement.

Aucune UI n'entre dans ce scénario.

## Tests AI-native de fondation

Dès Phase 1 :
- événement critique écrit dans la même transaction que l'état métier ;
- rollback transactionnel => aucun OutboxEvent orphelin ;
- retry consumer => effet idempotent ;
- event envelope contient tenant/actor/correlation/classification attendus ;
- aucun secret dans payload événementiel.

Avant toute feature probabiliste :
- cross-tenant retrieval impossible ;
- establishment scope appliqué avant retrieval ;
- prompt injection indirecte n'altère pas policies/tools ;
- structured output invalide refusé ;
- model timeout n'impacte pas le Core ;
- high-impact action sans confirmation refusée ;
- permission retirée entre proposition et exécution => action refusée ;
- replay tool => pas de duplication ;
- jeu d'évaluation versionné et seuils de release satisfaits.
