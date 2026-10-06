# 14 — Baseline sécurité

## Menaces prioritaires
1. IDOR / fuite cross-tenant.
2. élévation de privilèges.
3. vol/replay de session.
4. mass assignment.
5. brute force auth/invitations.
6. corruption d'historique commercial/financier.
7. upload malveillant.
8. fuite de secrets/logs.
9. injection.
10. abus de messagerie/réseau.

## Contrôles
- validation DTO stricte + whitelist ;
- guards deny-by-default ;
- requêtes tenant scoped ;
- Argon2id ;
- rotation refresh ;
- rate limiting partagé ;
- Helmet ;
- CORS allowlist ;
- prepared queries via ORM ;
- object storage privé ;
- audit immuable ;
- secret scanning + dependency audit ;
- CI sans secrets de prod ;
- backup chiffré selon fournisseur ;
- revue OWASP ASVS L2 applicable avant release.

## Principe
Une protection uniquement frontend est inexistante du point de vue sécurité.
