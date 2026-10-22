# 29 — Extensions futures

**Priorité normative après 10A :** convergence 10A.5 avec ZAMUREK ([ADR-039](104_ADR_039_SHARED_COMMERCE_CORE_ZAMUREK.md)) ; POS connecté, factures imprimables, agents communs et catalogue produit multi-abonnements sont désormais **des livrables planifiés**, pas des extensions hypothétiques repoussées après la sortie. Le POS transactionnel **hors ligne** reste explicitement différé.

La baseline actuelle conserve les forces structurelles de Monarque Connect sans reprendre un ERP tiers et les ancre désormais dans une architecture AI-native à Core déterministe. Les extensions suivantes restent hors MVP tant qu'une décision dédiée ne les ouvre pas :

- comptabilité statutaire OHADA/RDC ;
- paie et déclarations ;
- fiscalité automatisée ;
- achats avancés / contrats fournisseurs ;
- appels d'offres complexes ;
- abonnements SaaS et facturation automatique de Monarque Connect ;
- payment gateways ;
- clients mobiles propriétaires **pour Monarque Connect** (les clients Android ZAMUREK sont inclus dans la V1 ZAMUREK, pas reportés par cette liste) ;
- notifications SMS/push avancées ;
- POS offline ;
- moteur de recherche dédié ;
- API keys / intégrations tierces ;
- webhooks publics ;
- agents IA autonomes avancés et multi-step à haut impact ;
- benchmarking cross-tenant ;
- rôles personnalisés ;
- multi-warehouse avancé ;
- manufacturing/MRP ;
- tax engine ;
- financement/assurance/logistique partenaires ;
- avis publics, notation et score réputationnel avancé ;
- marketplace transactionnelle **multi-vendeurs et encaissement collectif** (le répertoire venue opt-in ZAMUREK V1 est planifié) ;
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

## Intelligence future

L'Event Fabric et l'intelligence déterministe 10A sont déjà implémentées ; l'AI Gateway/probabiliste demeure **planifiée pour 10B**, et l'Agent Runtime complet pour 11.5. Leurs contrats AI-native existent dans la baseline mais leur implémentation ne doit pas être déclarée acquise.

Restent différés jusqu'à validation :
- embeddings/vector search à grande échelle ;
- modèles de prévision avancés ;
- assistants conversationnels généralistes ;
- agents multi-outils autonomes ;
- fine-tuning/training sur données tenant ;
- benchmarking intelligent cross-tenant ;
- décisions automatisées à impact financier/juridique.
