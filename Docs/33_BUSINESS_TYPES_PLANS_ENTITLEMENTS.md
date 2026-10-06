# 33 — Business Types, Plans et Entitlements

## 1. Principe

Monarque Connect ne crée pas une application différente pour chaque secteur.

Le secteur influence l'onboarding et les modules recommandés, mais l'autorisation réelle vient du plan et des entitlements.

## 2. Business types initiaux

Les codes sont des données seedées, pas un enum DB fermé.

| Code | Segment | Modules recommandés |
|---|---|---|
| `SERVICE_PROVIDER` | Prestataires de services | CRM, CATALOG, SALES, EXPENSES, PROJECTS, DOCUMENTS + Network Suite |
| `COMMERCE_DISTRIBUTION` | Commerce / distribution | CATALOG, SALES, PURCHASES, INVENTORY, CASH, EXPENSES, DOCUMENTS + Network Suite |
| `MINING_SUPPLIER_B2B` | Fournisseur minier / B2B | CRM, CATALOG, SALES, PURCHASES, DOCUMENTS, INVENTORY optionnel + Network Suite |
| `SMALL_INDUSTRY` | Petite industrie | CATALOG, SALES, PURCHASES, INVENTORY, EXPENSES, DOCUMENTS, PROJECTS + Network Suite ; fabrication avancée différée |
| `OTHER` | Activité non encore spécialisée | CATALOG, CRM, SALES, DOCUMENTS + Network Suite |

**Network Suite** est uniquement un raccourci documentaire pour les vrais codes : `NETWORK_PROFILE`, `NETWORK_TRUST`, `NETWORK_DISCOVERY`, `NETWORK_CONNECTIONS`, `NETWORK_INQUIRIES`, `MESSAGING`. Le seed doit stocker les codes réels, jamais `NETWORK_SUITE`.

Un groupe multi-agences n'est pas un business type : c'est une organization possédant plusieurs establishments et une gouvernance adaptée.

## 3. Plans logiciels

### CONNECT
Cible : organisation cherchant visibilité, catalogue et opportunités.

Capacités :
- NETWORK_PROFILE
- NETWORK_TRUST
- NETWORK_DISCOVERY
- NETWORK_CONNECTIONS
- NETWORK_INQUIRIES
- MESSAGING
- CATALOG

Le core organisation/utilisateurs/établissement principal est toujours disponible.

### OPERATIONS
CONNECT +
- CRM
- SALES
- EXPENSES
- DOCUMENTS
- INTELLIGENCE_BASIC

### BUSINESS
OPERATIONS +
- PURCHASES
- INVENTORY
- CASH
- PROJECTS

Le plan autorise plusieurs établissements selon quota.

### ENTERPRISE
Tous les modules MVP + quotas/gouvernance configurables, support et infrastructure renforcés selon contrat.

### MANAGED
`Managed` est traité comme **overlay de service humain** sur une subscription CONNECT/OPERATIONS/BUSINESS/ENTERPRISE, et non comme duplication technique d'un plan. Le champ `managed_service` décrit cette offre.

## 4. Quotas initiaux

Codes possibles :
- `MAX_USERS`
- `MAX_ESTABLISHMENTS`
- `STORAGE_BYTES`
- `MAX_ACTIVE_PROJECTS`
- `MONTHLY_NETWORK_INQUIRIES`

Une absence de quota signifie "non borné par ce mécanisme", pas nécessairement illimité contractuellement.

## 5. Résolution d'un entitlement

Pour un module M :

1. vérifier organization ACTIVE ;
2. charger subscription active ;
3. calculer `baseAllowed` depuis `PlanModule(M)` ;
4. appliquer l'override actif : `ALLOW` force allowed, `DENY` force denied, `LIMIT_OVERRIDE` conserve `baseAllowed` ;
5. résoudre les limites effectives depuis plan puis override ;
6. vérifier dépendances du module ;
7. vérifier `OrganizationModuleActivation(M)` ;
8. appliquer RBAC et establishment scope.

### Précédence

- `DENY` explicite interdit ;
- `ALLOW` explicite peut ouvrir un module hors plan si Monarque Group l'accorde ;
- `LIMIT_OVERRIDE` ne change jamais le booléen d'accès, seulement les limites ;
- un override avec limites peut accompagner `ALLOW` lorsque nécessaire ;
- suspension tenant interdit toutes les capacités métier sauf endpoints de compte/support explicitement autorisés.

## 6. Activation

Un admin tenant peut :
- désactiver un module autorisé ;
- réactiver un module autorisé.

Il ne peut pas :
- s'accorder un module non entitled ;
- augmenter ses quotas ;
- modifier son plan ;
- contourner les dépendances.

## 7. Preset à l'onboarding

Lors de la création :
1. business type choisi ;
2. plan assigné : `CONNECT v1` par défaut pour une création standard ; un autre plan ne peut être assigné que par un flux plateforme autorisé ;
3. intersection entre preset métier et modules autorisés par le plan ;
4. modules `default_enabled` activés ;
5. établissement principal créé ;
6. capabilities calculées.

Le preset peut être modifié ensuite sans changer le business type.

## 8. Versionnement

Une version de plan utilisée par un client n'est pas mutée de manière destructive. Une nouvelle version est créée puis les subscriptions sont migrées explicitement.

Les `module_code` sont stables et ne sont pas recyclés.

## 9. Transition Phase 1 → Phase 2

Phase 1 peut créer des organizations avant l'existence technique des subscriptions. Elles n'ont alors accès qu'aux capacités core.

L'introduction de Phase 2 doit :
1. seeder le catalogue/modules/plans v1 ;
2. créer une subscription `CONNECT v1` pour toute organization ACTIVE existante sans subscription ;
3. calculer les activations initiales depuis le business type ;
4. être rejouable/idempotente ;
5. tester qu'aucune organization ne reste sans subscription active après migration.

Après Phase 2, toute création standard d'organization crée aussi sa subscription `CONNECT v1` dans le workflow d'onboarding, sans exposer au client le droit de s'auto-attribuer un plan supérieur.
