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

## Configuration IA future

Les credentials fournisseurs IA :
- ne sont jamais présents dans Git ;
- ne sont jamais exposés aux clients ;
- sont injectés comme secrets de plateforme ;
- sont séparés par environnement ;
- sont rotatables sans changement métier.

La sélection fournisseur/modèle est une configuration du AI Gateway/Model Registry, jamais une constante dispersée dans les modules métier.
