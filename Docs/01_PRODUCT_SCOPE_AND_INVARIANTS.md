# 01 — Périmètre MVP et invariants

## Mission

Monarque Connect permet à une entreprise de **se rendre visible, structurer ses opérations, commercer, suivre son activité et interagir avec d'autres entreprises** depuis un même système.

Le produit n'est ni un ERP générique à modules illimités ni un simple réseau social professionnel. Il combine réseau B2B, Business OS, intelligence opérationnelle et control plane.

## Piliers du produit

### Monarque Network
Profils publics, vérification/confiance, découverte, connexions B2B, demandes de devis/opportunités, messagerie et relations commerciales.

### Monarque Business OS
Organisation, établissements, utilisateurs, CRM, catalogue, ventes, achats, stock, caisse, dépenses, projets légers et documents.

### Monarque Intelligence
KPI, tableaux de bord, règles d'alerte et insights dérivés des données du tenant. Le socle est AI-native dès le départ ; les fonctions probabilistes avancées sont activées progressivement après validation de la qualité, de la sécurité et de la gouvernance.

### Monarque Control Plane
Plans, modules, entitlements, quotas, provisioning logique, statut tenant, support et audit plateforme.

## Capacités MVP

- identité et sessions ;
- organisation et profil métier ;
- établissements ;
- membres, rôles et scopes d'établissement ;
- plans, modules, entitlements et quotas ;
- clients/fournisseurs ;
- produits/services ;
- CRM ;
- devis et commandes clients ;
- factures et encaissements constatés ;
- achats : demandes de prix simples, commandes fournisseurs, réceptions ;
- dépenses ;
- caisse ;
- stock simple ;
- projets légers et tâches ;
- documents ;
- annuaire B2B ;
- vérification et signaux de confiance publiables ;
- demandes de connexion ;
- demandes commerciales réseau ;
- messagerie inter-entreprises ;
- KPI et alertes opérationnelles ;
- export/portabilité des données principales ;
- console plateforme Monarque Group.

## Hors périmètre MVP

Comptabilité statutaire complète, paie, fiscalité automatisée, MRP/fabrication avancée, POS offline avancé, paiement en ligne natif, wallet/crypto, financement/assurance, agents IA autonomes à haut impact, entraînement de modèles sur données tenant par défaut, marketplace grand public, microservices, Kafka/RabbitMQ, moteur de workflow générique et rôles personnalisables arbitrairement.

## Invariants

- **INV-001** : toutes les règles métier critiques sont exécutées côté serveur.
- **INV-002** : aucune donnée privée d'une organisation n'est lisible par une autre sans relation explicitement autorisée.
- **INV-003** : tout accès tenant requiert un membership actif.
- **INV-004** : un type d'entreprise est un template de configuration, jamais une autorisation de sécurité.
- **INV-005** : un plan définit un plafond fonctionnel ; il ne remplace jamais le RBAC.
- **INV-006** : une capacité est utilisable uniquement si son entitlement effectif est autorisé et son module actif.
- **INV-007** : toute action sur une ressource établissement-scopée vérifie le scope d'établissement du membre.
- **INV-008** : chaque organisation possède au moins un établissement actif ; un établissement principal est créé à l'onboarding.
- **INV-009** : les clients officiels découvrent les capacités via l'API ; ils ne codent pas les plans comme source de vérité.
- **INV-010** : prix/montants utilisent un décimal exact + devise ISO 4217.
- **INV-011** : UTC + RFC3339 pour le temps.
- **INV-012** : UUID pour les identifiants publics.
- **INV-013** : documents commerciaux émis conservent leurs snapshots historiques.
- **INV-014** : une modification de catalogue ne réécrit jamais un document transactionnel historique.
- **INV-015** : une facture `ISSUED` n'est pas modifiée silencieusement.
- **INV-016** : mouvements de stock et de caisse sont append-only ou compensés.
- **INV-017** : les messages sont immuables en MVP.
- **INV-018** : aucun secret réel dans Git.
- **INV-019** : les binaires ne sont pas stockés dans PostgreSQL.
- **INV-020** : aucune dépendance métier à la mémoire locale d'une instance API.
- **INV-021** : tout effet critique asynchrone est durable avant traitement.
- **INV-022** : aucune entité ORM brute n'est exposée.
- **INV-023** : toute API métier est versionnée sous `/api/v1`.
- **INV-024** : aucune interface graphique n'est nécessaire pour exécuter les use-cases du backend.
- **INV-025** : une suspension tenant ou entitlement prend effet côté serveur indépendamment de l'état d'un client.
- **INV-026** : la portabilité de base des données tenant est une capacité core non réservée à un plan premium.
- **INV-027** : aucune fonction locale RDC n'est présentée comme conforme juridiquement/fiscalement sans validation spécialisée.

- **INV-028** : le Core transactionnel reste déterministe ; aucune sortie probabiliste ne crée seule une vérité métier.
- **INV-029** : toute transition métier significative produit un événement de domaine structuré lorsque sa consommation future est pertinente.
- **INV-030** : les événements critiques sont enregistrés atomiquement avec l'état métier via transactional outbox.
- **INV-031** : aucun modèle IA ou agent n'accède directement à PostgreSQL ou aux secrets plateforme.
- **INV-032** : toute donnée utilisée par Intelligence/IA conserve classification et provenance suffisantes.
- **INV-033** : l'inférence et l'entraînement sont des finalités séparées ; training tenant est opt-in et désactivé par défaut.
- **INV-034** : toute récupération de contexte IA applique tenant, établissement, entitlement, permission et classification avant retrieval.
- **INV-035** : un contenu récupéré depuis document, message ou source externe est une donnée non fiable et ne peut modifier les politiques système.
- **INV-036** : toute action IA mutante passe par un command/tool typé, revalide les permissions et est idempotente lorsque nécessaire.
- **INV-037** : toute action IA à fort impact exige une confirmation humaine explicite.
- **INV-038** : une panne de fournisseur IA ne bloque jamais les parcours transactionnels fondamentaux.
