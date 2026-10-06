# 24 — Règles API-first

**API-first signifie ici que l'API est le produit primaire et autonome.**

1. Chaque use-case existe d'abord comme contrat HTTP.
2. Aucun use-case n'est terminé s'il faut une UI pour le tester.
3. OpenAPI est disponible avant ou au plus tard avec la verticale.
4. Une UI ne contourne jamais le backend.
5. Les clients n'accèdent jamais directement à PostgreSQL/S3.
6. Les clients ne calculent pas un statut métier faisant autorité.
7. Le backend peut être validé avec tests HTTP/CLI uniquement.
8. Toute intégration future utilise le même contrat ou un contrat d'intégration explicite.
9. Le frontend peut être réécrit sans migration métier.
10. Le backend peut fonctionner en production même si aucun client officiel n'est déployé.
11. Un client ne déduit jamais ses modules depuis le type d'entreprise.
12. Un client ne code jamais la matrice des plans comme source de vérité.
13. Un client découvre ses capacités via `/organizations/{organizationId}/capabilities`.
14. Même après découverte d'une capability, chaque endpoint revalide entitlement, rôle et scope.
15. Les routes plateforme sont isolées des routes tenant.

## Contract-first par verticale

Avant code :
- module code canonique ;
- entitlement requis ;
- permission requise ;
- établissement requis ou non ;
- quota éventuel ;
- DTO ;
- erreurs ;
- idempotence ;
- audit ;
- OpenAPI ;
- tests attendus.

## Parallelisation

Le contrat OpenAPI et la projection capabilities permettent à un développeur frontend de travailler avec mocks pendant que le backend est implémenté, sans recopier la logique métier.
