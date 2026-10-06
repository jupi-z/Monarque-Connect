# Contribution

## Ownership
Le dépôt et le produit sont exploités sous l'autorité de Monarque Group S.A.S. L'accès GitHub ne constitue ni une participation au capital, ni une copropriété du produit.

## Workflow
- `main` doit rester déployable.
- Branche courte : `feature/<scope>`, `fix/<scope>`, `docs/<scope>`.
- Pull Request obligatoire.
- CI verte obligatoire.
- Revue obligatoire pour tout changement de sécurité, schéma, API ou architecture.
- Squash merge recommandé.
- Aucun push direct sur `main`.

## Zones
- Backend/API, DB, sécurité, migrations : owner principal `@jupi-z`.
- Les autres workstreams sont attribués explicitement dans `Docs/22_WORKSTREAM_OWNERSHIP.md`.
- Un contributeur ne commence pas une zone non attribuée sans accord.

## Changement normatif
Tout changement de périmètre, contrat, architecture, modèle de données ou sécurité :
1. ouvre un ADR ;
2. identifie les documents impactés ;
3. décrit compatibilité/migration ;
4. met à jour les tests ;
5. incrémente la baseline si nécessaire.

## Definition of Done
Voir `Docs/20_DEFINITION_OF_DONE.md`.
