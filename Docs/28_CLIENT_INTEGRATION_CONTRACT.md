# 28 — Contrat d'intégration des clients

Les clients officiels sont des consommateurs remplaçables de l'API.

## Règles générales

Ils :
- consomment `/api/v1` ;
- génèrent de préférence leurs types depuis OpenAPI ;
- ne dupliquent pas les permissions comme autorité ;
- ne codent pas les plans ou business types comme mécanisme de feature access ;
- gèrent les enums inconnus sans crash lorsque le contrat le prévoit ;
- traitent `401`, `403`, `404`, `409`, `422`, `429` ;
- utilisent les curseurs tels quels ;
- envoient `Idempotency-Key` quand requis ;
- conservent un `clientMessageId` stable lors d'un retry ;
- n'interprètent jamais les UUID.

## Bootstrap client après login

1. récupérer `/auth/me` ;
2. lister les organizations accessibles ;
3. choisir l'organization active ;
4. appeler `/organizations/{id}/capabilities` ;
5. construire navigation/actions depuis cette projection ;
6. rafraîchir capabilities après changement de plan/module/établissement ou erreur d'entitlement.

## Capabilities

Le client peut utiliser :
- `effectiveModules` pour afficher les domaines disponibles ;
- `enabledModules` pour la configuration active ;
- `accessibleEstablishments` pour le sélecteur de contexte ;
- `permissions` pour améliorer l'UX ;
- `quotas` pour afficher limites/consommation.

Mais :
- cacher un bouton n'est pas un contrôle de sécurité ;
- une capability mise en cache ne garantit pas qu'une action est encore autorisée ;
- le backend peut refuser après downgrade, suspension ou modification de scope.

## Établissement actif

Les clients maintiennent un établissement de travail sélectionné lorsque nécessaire. Ils passent son identifiant dans les endpoints qui le demandent, mais le serveur vérifie qu'il appartient au tenant et au scope du membre.

## Repositories

Chaque frontend vit dans un dépôt séparé. Le repo backend fournit le contrat, pas des composants UI.
