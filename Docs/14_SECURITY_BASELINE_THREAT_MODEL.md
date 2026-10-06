# 14 — Baseline sécurité

## Menaces prioritaires

1. IDOR / fuite cross-tenant.
2. fuite cross-establishment dans un même tenant.
3. élévation de privilèges RBAC.
4. contournement d'entitlement ou de module désactivé.
5. accès plateforme abusif.
6. vol/replay de session.
7. mass assignment.
8. brute force auth/invitations.
9. corruption d'historique commercial/financier/stock/caisse.
10. upload malveillant.
11. fuite de secrets/logs.
12. injection.
13. abus de messagerie, inquiries ou sourcing réseau.
14. dépassement de quota par concurrence/race condition.
15. cache client obsolète après downgrade, suspension ou retrait d'un module.
16. export tenant utilisé comme vecteur d'exfiltration ou mélange cross-tenant.

## Contrôles

- validation DTO stricte + whitelist ;
- policies deny-by-default ;
- requêtes tenant scoped ;
- vérification d'établissement ;
- entitlement check serveur à chaque action protégée ;
- activation de module séparée du droit commercial ;
- quotas contrôlés transactionnellement lorsqu'ils protègent une ressource rare/coûteuse ;
- suspension/downgrade effectifs côté serveur sans attendre le frontend ;
- Argon2id ;
- rotation refresh ;
- rate limiting ;
- Helmet ;
- CORS allowlist ;
- prepared queries via ORM ;
- object storage privé ;
- audit immuable ;
- exports privés, expirants, sans secrets et tenant-scoped ;
- secret scanning + dependency audit ;
- CI sans secrets de prod ;
- backup chiffré selon fournisseur ;
- revue OWASP ASVS L2 applicable avant release.

## Support plateforme

Un rôle `PLATFORM_SUPPORT` :
- n'obtient pas automatiquement accès aux données métier ;
- utilise des opérations de support explicitement prévues ;
- toute élévation temporaire future exige raison, durée, audit et policy dédiée.

## Réseau

Les données partagées via NetworkInquiry, RFQ réseau ou messagerie sont des projections explicitement destinées au partenaire. Aucun objet interne complet n'est sérialisé par défaut.

## Principe

Une protection uniquement frontend est inexistante du point de vue sécurité. Les menus cachés et les feature flags client ne constituent jamais un contrôle d'accès.
