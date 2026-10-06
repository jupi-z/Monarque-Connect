# 44 — Provenance, classification et politique IA

## Objectif

Toute intelligence fiable dépend de données dont l'origine, la sensibilité et la finalité sont connues.

## Classification canonique

- `PUBLIC` : volontairement publié ;
- `INTERNAL` : usage interne ordinaire du tenant ;
- `CONFIDENTIAL` : clients, prix, factures, fournisseurs, contrats, stock ;
- `RESTRICTED` : données personnelles sensibles, bancaires, paie future, secrets ou pièces fortement sensibles ;
- `PLATFORM_SECRET` : secrets techniques, clés, tokens ; jamais contenu IA.

## Provenance minimale

Pour toute donnée projetée vers Intelligence/Knowledge lorsque applicable :
- ressource source ;
- sourceId ;
- organizationId ;
- establishmentId? ;
- createdBy / observedBy ;
- sourceEventId? ;
- timestamp ;
- classification ;
- purpose ;
- version ou hash lorsque utile.

## Politique IA tenant

La future `OrganizationAiPolicy` contient au minimum :
- `aiFeaturesEnabled` ;
- `externalModelProcessingAllowed` ;
- `allowedDataClasses` ;
- `trainingOptIn` — défaut **false** ;
- `retentionPreference` lorsque le fournisseur le permet ;
- `updatedBy`, `updatedAt`.

Cette policy prépare l'architecture ; elle ne force pas l'activation d'une feature IA avant sa release.

## Principes

- données PUBLIC/INTERNAL ne sont pas automatiquement autorisées pour un fournisseur externe ;
- CONFIDENTIAL nécessite finalité explicite et policy ;
- RESTRICTED est refusé par défaut aux modèles externes ;
- PLATFORM_SECRET est toujours interdit ;
- trainingOptIn=false par défaut, indépendamment de l'autorisation d'inférence ;
- l'inférence et l'entraînement sont deux finalités distinctes ;
- une autorisation tenant ne contourne pas la loi, le contrat, le RBAC ou les scopes.

## Minimisation

Avant inference :
1. déterminer la finalité ;
2. sélectionner uniquement les champs nécessaires ;
3. appliquer tenant/establishment/RBAC ;
4. redacter ou pseudonymiser lorsque possible ;
5. enregistrer metadata/provenance de l'utilisation.

## Cross-tenant

Aucune donnée identifiable d'un tenant ne sert au contexte d'un autre.

Le benchmarking futur exige agrégation, anonymisation, seuils anti-réidentification et gouvernance séparée.
