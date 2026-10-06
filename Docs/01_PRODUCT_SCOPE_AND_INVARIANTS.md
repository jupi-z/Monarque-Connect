# 01 — Périmètre MVP et invariants

## Mission
Permettre à une entreprise de gérer ses opérations commerciales essentielles et d'interagir avec d'autres organisations Monarque Connect.

## Capacités MVP
- compte utilisateur ;
- organisation et membres ;
- clients/fournisseurs ;
- produits/services ;
- CRM simple ;
- devis ;
- commandes ;
- factures ;
- enregistrement d'encaissements ;
- dépenses ;
- stock simple ;
- documents ;
- annuaire B2B ;
- demandes de connexion ;
- messagerie inter-entreprises ;
- console plateforme pour Monarque Group.

## Hors périmètre MVP
Comptabilité générale complète, paie, MRP, fiscalité automatisée, marketplace grand public, paiement en ligne natif, wallet, crypto, IA autonome, microservices, Kafka/RabbitMQ, Elasticsearch/OpenSearch, custom roles, workflow engine générique.

## Invariants
- **INV-001** : toutes les règles métier critiques sont exécutées côté serveur.
- **INV-002** : aucune donnée privée d'une organisation n'est lisible par une autre sans relation métier explicitement autorisée.
- **INV-003** : tout accès tenant est validé contre un membership actif.
- **INV-004** : prix/montants utilisent un décimal exact + devise ISO 4217.
- **INV-005** : UTC + RFC3339 pour le temps.
- **INV-006** : UUID pour les identifiants publics.
- **INV-007** : documents commerciaux émis conservent leurs snapshots historiques.
- **INV-008** : une modification de catalogue ne réécrit jamais un devis, une commande ou une facture historique.
- **INV-009** : une facture `ISSUED` n'est pas modifiée silencieusement ; correction par opérations explicites.
- **INV-010** : les mouvements de stock sont append-only/compensés, pas réécrits.
- **INV-011** : les messages sont immuables en MVP.
- **INV-012** : aucun secret réel dans Git.
- **INV-013** : les binaires ne sont pas stockés dans PostgreSQL.
- **INV-014** : aucune dépendance métier à la mémoire locale d'une instance API.
- **INV-015** : tout effet critique asynchrone est durable avant traitement.
- **INV-016** : aucune entité ORM brute n'est exposée.
- **INV-017** : toute API métier est versionnée sous `/api/v1`.
- **INV-018** : aucune interface graphique n'est nécessaire pour exécuter les use-cases du backend.
