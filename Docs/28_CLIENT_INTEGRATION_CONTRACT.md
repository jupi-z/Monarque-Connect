# 28 — Contrat d'intégration des clients

Les clients :
- consomment `/api/v1` ;
- génèrent de préférence leurs types depuis OpenAPI ;
- ne dupliquent pas les permissions comme autorité ;
- gèrent les enums inconnus sans crash ;
- traitent `401`, `403`, `409`, `422`, `429` ;
- utilisent les curseurs tels quels ;
- envoient `Idempotency-Key` quand requis ;
- conservent un `clientMessageId` stable lors d'un retry ;
- n'interprètent jamais les UUID.

## Repositories
Le premier frontend choisi par `@Gabby344` doit vivre dans un dépôt séparé. Ce repo backend fournit le contrat, pas des composants UI.
