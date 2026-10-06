# 39 — Acceptance de la baseline v1.1

La baseline v1.1 est considérée prête pour exécution uniquement si les points suivants restent vrais.

## Architecture

- [x] backend propriétaire, API-first et autonome ;
- [x] aucun ERPNext/Frappe dans l'architecture cible ;
- [x] monolithe modulaire ;
- [x] PostgreSQL source de vérité ;
- [x] clients séparés du backend.

## Produit

- [x] quatre piliers explicitement définis ;
- [x] business types = presets ;
- [x] plans versionnés ;
- [x] entitlements distincts des activations ;
- [x] quotas extensibles ;
- [x] établissement principal obligatoire ;
- [x] scopes d'établissement ;
- [x] achats, caisse et projets légers dans le MVP ;
- [x] vérification/confiance réseau définie sans score opaque ;
- [x] NetworkInquiry relie Network et CRM ;
- [x] Intelligence MVP sans dépendance IA ;
- [x] Control Plane séparé du tenant ;
- [x] frontière de localisation RDC documentée ;
- [x] portabilité/export tenant core documentés.

## Sécurité

- [x] tenant isolation définie ;
- [x] establishment isolation définie ;
- [x] entitlement enforcement côté serveur ;
- [x] RBAC deny-by-default ;
- [x] rôles plateforme séparés ;
- [x] support sans accès métier universel ;
- [x] downgrade/suspension côté serveur ;
- [x] audit des changements de plan/entitlement.

## API

- [x] surface OpenAPI v0.2.0 mise à jour ;
- [x] capabilities endpoint défini ;
- [x] establishment endpoints définis ;
- [x] purchases/cash/projects définis ;
- [x] network trust/inquiries définis ;
- [x] création d'inquiry porte une source organization explicite et vérifiée ;
- [x] intelligence définie ;
- [x] control plane défini.

## Exécution

La prochaine phase est **Phase 1 — Identity & tenancy**, puis **Phase 2 — Product entitlements** avant les verticales métier.

Aucun module métier ne doit inventer localement sa propre logique de plan, entitlement, scope ou quota.
