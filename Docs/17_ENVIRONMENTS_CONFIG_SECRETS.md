# 17 — Environnements, config et secrets

Environnements : `development`, `test`, `staging`, `production`.

## Principe

Toute configuration **utilisée par le code actif** est validée fail-fast au démarrage. Une verticale ajoute la validation de ses variables dans la même PR qui introduit leur usage.

Cela évite deux erreurs opposées :
- démarrer avec une configuration réellement requise mais invalide ;
- exiger prématurément des secrets de modules qui n'existent pas encore.

## Fondation active

Variables actuellement utilisées :

- `NODE_ENV` — défaut `development` ;
- `PORT` — défaut `3000` ;
- `DATABASE_URL` — obligatoire, PostgreSQL ;
- `CORS_ORIGINS` — liste exacte séparée par virgules ; vide = aucun origin navigateur autorisé.

`.env.example` contient uniquement des placeholders/données de développement.

## Variables activées avec les verticales

### Auth
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- clés de signature/rotation

### Object storage / documents
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- credentials storage

### Notifications futures
- configuration fournisseur email/SMS selon la verticale concernée

### Observabilité
- niveau/configuration de logs selon l'implémentation retenue

Chaque groupe devient obligatoire uniquement lorsque son module est implémenté.

## Production

- secrets injectés par le système de déploiement ;
- jamais commités ;
- rotation possible sans migration métier ;
- CORS en allowlist exacte ;
- aucune valeur de démonstration de `.env.example` réutilisée comme secret.

## Configuration IA future

Les credentials fournisseurs IA :
- ne sont jamais présents dans Git ;
- ne sont jamais exposés aux clients ;
- sont injectés comme secrets de plateforme ;
- sont séparés par environnement ;
- sont rotatables sans changement métier.

La sélection fournisseur/modèle est une configuration du AI Gateway/Model Registry, jamais une constante dispersée dans les modules métier.
