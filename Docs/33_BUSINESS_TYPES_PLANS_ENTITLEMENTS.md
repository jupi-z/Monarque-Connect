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

Les quotas distinguent explicitement deux modes :

- `CAPACITY` : capacité simultanée, stockée dans le compteur canonique `CURRENT` et jamais réinitialisée par la période de facturation (`MAX_USERS`, `MAX_ESTABLISHMENTS`) ;
- `PERIODIC` : consommation de flux, partitionnée par mois ou par année selon le plan (`MONTHLY_*`, `YEARLY_*`).

## 5. Résolution d'un entitlement

Pour un module M :

1. vérifier organization ACTIVE ;
2. charger subscription active ;
3. calculer `baseAllowed` depuis `PlanModule(M)` ;
4. appliquer l'override actif : `ALLOW` force allowed, `DENY` force denied, `LIMIT_OVERRIDE` conserve `baseAllowed`; les overrides sont interdits sur les modules core et un override de limite ne s'applique qu'au module propriétaire du quota ;
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
2. plan assigné ;
3. intersection entre preset métier et modules autorisés par le plan ;
4. modules `default_enabled` activés ;
5. établissement principal créé ;
6. capabilities calculées.

Le preset peut être modifié ensuite sans changer le business type.

## 8. Versionnement

Une version de plan utilisée par un client n'est pas mutée de manière destructive. Une nouvelle version est créée puis les subscriptions sont migrées explicitement.

Les `module_code` sont stables et ne sont pas recyclés.

## 9. Évolution normative FairScale V1 (après clôture Phase 9)

La politique de tarification et de capacité **cible** est décrite par [Docs/89](89_FAIRSCALE_V1_NORMATIVE_SPEC.md) et l'[ADR-038](94_ADR_038_FAIRSCALE.md). Elle n'est **pas implémentée** dans le seed actuel : ne pas affirmer que ses prix ou capacités sont déjà activés.

- CONNECT reste gratuit, OPERATIONS 15 USD/mois, BUSINESS 45 USD/mois, ENTERPRISE 180 USD/mois (prix de base) ; annuel -20 % à chaque paiement ; mensualités de bienvenue -15 % lors de trois échéances admissibles, une fois par entreprise.
- Les modules ci-dessus restent la frontière fonctionnelle. Le secteur/taille/effectif n'impose pas le plan.
- Le plafond commercial MAX_USERS est retiré des **plans payants** uniquement après migration ; les 5 utilisateurs CONNECT restent garde-fou du gratuit. Aucun supplément par employé payant.
- Capacités de référence : 1/1/3/10 établissements, souscripteur peut acquérir une capacité d'établissement additionnelle via paiement et consentement ; quota effectif côté serveur, jamais décision frontend.
- La Phase 9.5 implémente catalogue et quotas ; la Phase 9.6 implémente l'encaissement et la gestion d'abonnement. Les versions historiques ne sont jamais réécrites pour leur faire dire qu'elles ont toujours eu ces propriétés.


## Projet ZAMUREK — complément planifié, non implémenté

La convergence ([ADR-039](104_ADR_039_SHARED_COMMERCE_CORE_ZAMUREK.md), [phase 10A.5](105_PHASE_10A5_CONVERGENCE_EXECUTION_SPEC.md)) introduira des **produits commercialisés distincts**, sans refaire les plans FairScale. `ZAMUREK_BASIC` à **7 USD/mois/organisation** est une proposition commerciale validée en principe, mais pas encore un plan seedé, facturé ou juridiquement approuvé. Les souscriptions `MONARQUE_CONNECT` et `ZAMUREK` pourront coexister sur une même organisation. Les droits seront calculés par `productCode` + plan versionné + permissions + établissement, jamais par frontend. La seule souscription ZAMUREK devra autoriser ses fonctions nécessaires (POS, vente publique, verticales) mais **pas** le CRM/achats/projets ni les modules Enterprise de Monarque Connect.

**Conflit économique à arbitrer avant vente réelle :** les quotas FairScale actuels 1/1/3/10 établissements ne deviennent pas implicitement illimités dans l'offre ZAMUREK à 7 USD. Définir une capacité incluse et les coûts supplémentaires réels dans un contrat et des entitlements à tester. Aucun tarif supplémentaire n'est inventé dans ce cadrage.
