# 29 — Extensions futures

La baseline v1.1 réintroduit les forces structurelles de Monarque Connect sans reprendre un ERP tiers. Les extensions suivantes restent hors MVP tant qu'une décision dédiée ne les ouvre pas :

- comptabilité statutaire OHADA/RDC ;
- paie et déclarations ;
- fiscalité automatisée ;
- achats avancés / contrats fournisseurs ;
- appels d'offres complexes ;
- abonnements SaaS et facturation automatique de Monarque Connect ;
- payment gateways ;
- mobile natif ;
- notifications SMS/push avancées ;
- POS offline ;
- moteur de recherche dédié ;
- API keys / intégrations tierces ;
- webhooks publics ;
- IA générative/décisionnelle ;
- benchmarking cross-tenant ;
- rôles personnalisés ;
- multi-warehouse avancé ;
- manufacturing/MRP ;
- tax engine ;
- financement/assurance/logistique partenaires ;
- marketplace transactionnelle ;
- microservices si un besoin réel les justifie.

## Règles d'extension

Toute extension :
1. reçoit un `module_code` stable ;
2. définit ses dépendances ;
3. précise les plans éligibles sans les coder dans les controllers ;
4. définit entitlement, activation, quota éventuel, RBAC et establishment scope ;
5. fournit contrat OpenAPI, migration, tests, audit et rollback/forward-fix ;
6. conserve les IDs et historiques existants ;
7. ne peut pas réintroduire ERPNext/Frappe comme dépendance métier cachée sans nouvel ADR explicitement approuvé.
