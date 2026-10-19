# 35 — Monarque Control Plane

## Mission

Le Control Plane permet à Monarque Group d'exploiter Monarque Connect comme un SaaS industrialisé, sans accès direct à la base pour les opérations normales.

## Capacités MVP

### Tenant registry
- liste/recherche organizations ;
- business type ;
- statut ;
- plan/version ;
- dates de subscription ;
- managed service ;
- consommation de quotas utile au support.

### Plan management
- catalogue de plans ;
- versions ;
- module entitlements ;
- limites par défaut ;
- statut DRAFT/ACTIVE/RETIRED.

### Network verification
- statut de vérification ;
- date/expiration éventuelle ;
- niveau ou méthode interne versionnée si utilisée ;
- raison/preuve interne non publique ;
- audit de toute décision.

### Organization entitlements
- ALLOW ;
- DENY ;
- LIMIT_OVERRIDE ;
- période de validité ;
- raison obligatoire ;
- auteur plateforme.

### Tenant lifecycle
- activation ;
- suspension ;
- reprise ;
- clôture logique future selon politique de rétention.

### Support
- diagnostic non sensible ;
- health tenant ;
- audit ;
- aucune lecture métier universelle par défaut.

## Rôles

### PLATFORM_ADMIN
Peut gérer plans, entitlements et statut tenant.

### PLATFORM_SUPPORT
Peut consulter métadonnées de support et exécuter les opérations explicitement permises. Aucun accès direct implicite aux factures, messages, documents ou données RH futures.

## Audit obligatoire

Auditer :
- changement de plan ;
- entitlement ajouté/modifié/retiré ;
- quota override ;
- suspension/reprise ;
- changement de business type ;
- décision de vérification/dé-vérification ;
- opération de support sensible.

Chaque événement inclut actor, target tenant, before/after filtré, raison et requestId.

## Séparation tenant / plateforme

Un OWNER tenant n'est pas PLATFORM_ADMIN.  
Un PLATFORM_ADMIN n'est pas automatiquement membre du tenant.

Toute future fonctionnalité d'impersonation/support temporaire exige un ADR spécifique et un modèle de consentement/expiration.

## Idempotence

Les changements de statut, plan et entitlement sont idempotents et protégés contre les mises à jour concurrentes via version/optimistic concurrency ou transaction adaptée.

## API

Les routes sont sous `/api/v1/platform/*` et protégées par une policy plateforme distincte.

## FairScale V1 — tranche Billing du Control Plane (Phase 9.6)

À ajouter **sans déclarer la Phase 11 globale achevée** : tableau d'exploitation des souscriptions/prix versionnés, invoices plateforme, paiements rapprochés, redemptions promo, incidents et dérogations temporaires auditables. Limiter PLATFORM_SUPPORT aux métadonnées nécessaires, PLATFORM_ADMIN aux mutations autorisées. Aucun accès implicite à SALES tenant, à l'historique privé, ou aux clés prestataire. Les mutations d'argent et de droits sont idempotentes et émettent Audit/Outbox atomiques. Source : [FairScale V1](89_FAIRSCALE_V1_NORMATIVE_SPEC.md), [Phase 9.6](91_PHASE_9_6_FAIRSCALE_BILLING_EXECUTION_SPEC.md).
