# Machine-readable contracts

Ce dossier contient les contrats structurants qui doivent rester indépendants d'un fournisseur IA.

## Fichiers

- `domain-event.schema.json` — envelope canonique des DomainEvents.
- `agent-action-proposal.schema.json` — proposition structurée d'action agentique future.

## Gouvernance

- modification incompatible = nouvelle version de contrat/schema ;
- CI valide la structure de base via `npm run contracts:validate` ;
- les implémentations TypeScript doivent être dérivables ou testées contre ces contrats ;
- aucun secret ou détail d'infrastructure fournisseur dans ces schemas.

OpenAPI reste dans `openapi/` pour le contrat HTTP.
