# 20 — Definition of Done MVP

Le MVP n'est terminé que lorsque :

## Produit
- [ ] auth/users
- [ ] organizations/memberships/invitations
- [ ] parties
- [ ] catalogue
- [ ] CRM
- [ ] quotes
- [ ] orders
- [ ] invoices
- [ ] payment records
- [ ] expenses
- [ ] inventory
- [ ] network
- [ ] messaging
- [ ] documents/media
- [ ] platform admin

## Sécurité
- [ ] tenant isolation E2E complète
- [ ] RBAC deny-by-default
- [ ] refresh rotation/replay detection
- [ ] rate limits
- [ ] ASVS L2 applicable revue
- [ ] aucun secret
- [ ] audit sensible

## Données
- [ ] migrations base vide
- [ ] upgrade version précédente
- [ ] concurrence critique
- [ ] backup/restore prouvé

## API
- [ ] OpenAPI 3.1 complète
- [ ] aucun use-case métier dépend d'une UI
- [ ] exemples et erreurs
- [ ] compatibilité contrôlée

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
