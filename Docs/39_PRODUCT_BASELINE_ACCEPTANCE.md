# 39 — Acceptance de la baseline produit

Cette checklist confirme que le modèle produit v1.2 est cohérent avant implémentation.

## Architecture

- [x] backend propriétaire, API-first et autonome ;
- [x] aucun ERPNext/Frappe dans l'architecture cible ;
- [x] monolithe modulaire ;
- [x] PostgreSQL source de vérité ;
- [x] clients séparés du backend ;
- [x] Core déterministe séparé d'Intelligence/IA.

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
- [x] Intelligence déterministe dans le MVP ;
- [x] fondation AI-native prévue sans dépendance fournisseur ;
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
- [x] audit des changements de plan/entitlement ;
- [x] actions IA à fort impact soumises à confirmation ;
- [x] retrieval futur pré-filtré par tenant/scope.

## API et contrats

- [x] surface OpenAPI définie ;
- [x] capabilities endpoint défini ;
- [x] establishment endpoints définis ;
- [x] purchases/cash/projects définis ;
- [x] network trust/inquiries définis ;
- [x] création d'inquiry porte une source organization explicite et vérifiée ;
- [x] intelligence définie ;
- [x] control plane défini ;
- [x] Domain Event contract machine-readable défini ;
- [x] Agent Action Proposal contract machine-readable défini ;
- [x] validation des contrats intégrée à la CI.

## Exécution

L'ordre de lancement est :
1. **Phase 0.5 — AI-native foundation** ;
2. **Phase 1 — Identity & tenancy** ;
3. **Phase 2 — Product entitlements** ;
4. verticales métier selon `21_EXECUTION_ROADMAP.md`.

Aucun module métier ne doit inventer localement sa propre logique de plan, entitlement, scope, quota, événement ou autorisation agentique.
