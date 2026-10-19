# 20 — Definition of Done MVP

> Note de statut : cette checklist couvre le MVP global et reste volontairement ouverte pour les domaines non livrés. La clôture stricte de Phase 2 est indépendante et documentée dans `59_PHASE_2_CLOSURE_EVIDENCE.md` ; elle ne justifie pas de cocher les éléments des phases métier suivantes.

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
- [ ] network profiles/verification/trust/discovery/connections/inquiries
- [ ] messaging
- [ ] documents/media
- [ ] intelligence KPI/alerts
- [ ] tenant data export/portability
- [ ] platform control plane

## Commercialisation SaaS — FairScale V1 (phases 9.5 et 9.6)

- [ ] prix en USD versionnés et exacts : 15/45/180 USD mensuels, CONNECT gratuit
- [ ] welcome mensuel -15 % trois premières mensualités admissibles, une fois par entreprise, sans réactivation
- [ ] réduction annuelle -20 % à **chaque** paiement annuel, sans cumul avec welcome
- [ ] plans payants sans limitation commerciale au nombre d'utilisateurs internes
- [ ] capacité d'établissements incluse + addons explicites et audités
- [ ] factures, paiements et renouvellements plateforme distincts de SALES métier
- [ ] checkout/activation uniquement après paiement confirmé ; pas de double activation ni double débit sur replays
- [ ] résiliation et downgrade conservent les données et l'export, dunning/audit vérifiés
- [ ] clôture séparée des Phases 9.5 et 9.6 avec preuves Docs/92, CI GitHub PR puis post-fusion
- [ ] revue des exigences juridiques de vente et de facturation de Monarque Group avant lancement commercial

## Produit à quatre piliers

- [ ] Network expose un profil de confiance sans score opaque
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
- [ ] export tenant principal généré et relu

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

## AI-native foundation

- [ ] Domain Event envelope implémenté et versionné
- [ ] transactional outbox utilisée dès les domaines Phase 1
- [ ] consumers idempotents
- [ ] actor USER/SYSTEM/AGENT/PLATFORM supporté par le contrat
- [ ] classification et purpose présents dans les événements
- [ ] correlation/causation/request IDs propagés
- [ ] aucun secret dans les événements
- [ ] Core totalement fonctionnel sans fournisseur IA
- [ ] aucun accès IA direct à PostgreSQL
- [ ] data provenance contract documenté et testable
- [ ] AI policy default trainingOptIn=false
- [ ] AI Gateway/provider abstraction définie avant première inference
- [ ] action agentique future obligatoirement via commands/tools
- [ ] sécurité prompt injection/retrieval couverte avant première feature IA
