# Plan — Durcissement normatif de la Phase 2

## Objectif

Aligner la livraison Phase 2 avec les invariants définis dans les spécifications du dépôt avant toute implémentation métier Phase 3. La clôture ne sera annoncée qu'après réussite des tests ciblés, de la suite complète, des migrations sur base vide et en upgrade, de la validation OpenAPI et de la CI GitHub.

## Séquence d'exécution

1. **Entitlements explicites et projection effective**
   - Introduire le modèle persistant d'override organisationnel (`ALLOW`, `DENY`, `LIMIT_OVERRIDE`) avec période de validité, justification et auteur de plateforme.
   - Implémenter le service et les routes plateforme déjà déclarées dans OpenAPI.
   - Appliquer la priorité déterministe des overrides, sans confondre inclusion au plan et activation par défaut.
   - Exposer les presets métier persistés dans la projection et appliquer la règle normative d'Intelligence nécessitant un module métier actif.
   - Ajouter les tests rouges puis verts pour chaque comportement.

2. **Quotas canoniques et enforcement des ressources**
   - Faire calculer la période par le serveur à partir du plan effectif et de la date d'évaluation; supprimer la confiance dans un `periodKey` fourni par l'appelant.
   - Ajouter des primitives transactionnelles partagées pour consommer une capacité de façon atomique.
   - Faire respecter `MAX_USERS` lors de l'acceptation d'une invitation et `MAX_ESTABLISHMENTS` lors de la création d'un établissement, y compris pour la création atomique d'une organisation.
   - Provisionner explicitement le plan initial de l'organisation avec un choix par défaut documenté, dans la même transaction que l'organisation, son établissement et son owner.
   - Tester les courses concurrentes et les rejets de dépassement.

3. **Invariants PostgreSQL des abonnements**
   - Ajouter une contrainte d'exclusion PostgreSQL sur les plages temporelles des abonnements effectifs.
   - Conserver le pré-contrôle applicatif pour l'expérience utilisateur et mapper les violations concurrentes en conflit métier.
   - Tester deux créations concurrentes de périodes finies qui se chevauchent.

4. **Référentiel, documentation et gouvernance**
   - Rendre le seed des presets idempotent et compléter les dépendances/règles normatives du catalogue.
   - Mettre à jour schéma OpenAPI, README, statuts et preuves Phase 2 avec les comportements réellement livrés.
   - Cocher les gates vérifiées dans l'issue #10, marquer Phase 2 terminée dans le tracker #11 et conserver une mention honnête de la protection technique de `main` tant que le plan GitHub ne permet pas la ruleset.

## Vérification finale

La branche sera considérée prête uniquement si `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run openapi:validate`, `npm run contracts:validate`, `npm run prisma:validate` et `npm run prisma:phase2:migration-proof` passent sur un environnement propre. Le résultat sera livré par PR, CI verte et squash merge; aucune branche de travail ne restera après intégration.
