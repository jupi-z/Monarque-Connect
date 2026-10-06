# 17 — Environnements, config et secrets

Environnements : `development`, `test`, `staging`, `production`.

## Config
Validation fail-fast au démarrage.

Variables minimales :
- `DATABASE_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- clés de signature/rotation
- `S3_ENDPOINT`
- `S3_BUCKET`
- credentials storage
- `CORS_ORIGINS`
- email provider config
- log level

`.env.example` contient uniquement des placeholders.

Production : secrets injectés par le système de déploiement, jamais commités.
