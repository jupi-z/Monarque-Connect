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
