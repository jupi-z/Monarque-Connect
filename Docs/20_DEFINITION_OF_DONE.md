# 20 — Definition of Done MVP

Le MVP n'est terminé que lorsque :

## Produit

- [ ] auth/users/sessions
- [ ] organizations/business types
- [ ] establishments
- [ ] memberships/invitations/establishment scopes
- [ ] module catalog/plans/subscriptions/entitlements/quotas
- [ ] parties
- [ ] catalogue
- [ ] CRM
- [ ] quotes
- [ ] orders
- [ ] invoices
- [ ] payment records
- [ ] purchases/RFQ/goods receipts
- [ ] expenses
- [ ] cash
- [ ] inventory
- [ ] projects/tasks
- [ ] network profiles/discovery/connections/inquiries
- [ ] messaging
- [ ] documents/media
- [ ] intelligence KPI/alerts
- [ ] platform control plane

## Produit à quatre piliers

- [ ] Network alimente réellement CRM via inquiry → opportunity
- [ ] Business OS couvre un cycle vente et un cycle achat
- [ ] Intelligence expose des KPI/alertes dérivés du backend
- [ ] Control Plane peut gérer plan/entitlement/statut d'un tenant
- [ ] business type applique un preset sans devenir une règle d'autorisation
- [ ] capabilities endpoint représente correctement l'état effectif

## Sécurité

- [ ] tenant isolation E2E complète
- [ ] establishment scope E2E complet
- [ ] entitlement enforcement E2E complet
- [ ] RBAC deny-by-default
- [ ] refresh rotation/replay detection
- [ ] rate limits
- [ ] quotas critiques race-safe
- [ ] downgrade/suspension immédiats côté serveur
- [ ] ASVS L2 applicable revue
- [ ] aucun secret
- [ ] audit sensible

## Données

- [ ] migrations base vide
- [ ] upgrade version précédente
- [ ] concurrence critique
- [ ] snapshots documents commerciaux
- [ ] stock append-only/compensation
- [ ] cash append-only/compensation
- [ ] backup/restore prouvé

## API

- [ ] OpenAPI 3.1 complète
- [ ] aucun use-case métier dépend d'une UI
- [ ] capabilities/entitlements documentés
- [ ] erreurs/exemples
- [ ] compatibilité contrôlée
- [ ] aucun frontend ne doit coder les plans comme autorité

## Ops

- [ ] image Docker non-root
- [ ] health live/ready
- [ ] logs/requestId
- [ ] metrics
- [ ] staging
- [ ] performance baseline
- [ ] rollback/forward-fix

## Canonical E2E

- [ ] scénario de `15_TEST_STRATEGY.md` passe entièrement par HTTP.
