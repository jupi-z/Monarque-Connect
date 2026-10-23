# Phase 10A.5 — C0 audit du Core et préparation inter-dépôts

**Date de vérification : 23/10/2026**
**Dépôt audité :** `jupi-z/Monarque-Connect`
**Baseline de code :** `main@da0da7277587a5506636fe3633180a3febf5c8ec`
**État :** audit documentaire/code effectué ; **C0 reste IN_PROGRESS, non accepté**. Ce rapport n'autorise ni migration métier, ni implémentation C1–C8, ni démarrage du code ZAMUREK.

## 1. Preuves de baseline

- `git ls-remote origin refs/heads/main` et `origin/main` concordent exactement sur `da0da7277587a5506636fe3633180a3febf5c8ec` lors de cette vérification.
- La CI du commit de référence est verte : [Backend CI #39787356963](https://github.com/jupi-z/Monarque-Connect/actions/runs/39787356963). L'inspection des jobs/logs confirme le job `validate-main / validate` en `success`, les preuves migrations base vide et upgrade des phases 1, 2, 4, 5, 6, 7, 9/9.5, 9.6 et 10A, `npm test`, la suite HTTP E2E, OpenAPI, contrats, lint, typecheck, build et smoke HTTP tous réussis sur cette baseline.
- Le schéma de cette baseline contient 54 fichiers `migration.sql` sous `prisma/migrations`. Ce comptage ne remplace pas l'exécution de preuve PostgreSQL/upgrade prévue dans les gates.
- La PR de cadrage [#152](https://github.com/jupi-z/Monarque-Connect/pull/152) est en brouillon ; l'issue [#153](https://github.com/jupi-z/Monarque-Connect/issues/153) conserve le gate C0 ouvert. La CI PR observée avant cette mise à jour documentaire est [run #39847069095](https://github.com/jupi-z/Monarque-Connect/actions/runs/39847069095) ; son résultat ne s'applique pas au présent commit tant que celui-ci n'a pas été poussé et contrôlé.
- ZAMUREK est audité séparément : `jupi-z/ZAMUREK` main à `0ac6bbc2c00048335b4de88cc686e88247da783a`, CI main verte [run #39840078492](https://github.com/jupi-z/ZAMUREK/actions/runs/39840078492). Sa PR de cadrage #2 reste en brouillon ; CI du commit observé verte [run #39847468670](https://github.com/jupi-z/ZAMUREK/actions/runs/39847468670). Aucun changement n'est apporté à ce dépôt par ce rapport.

## 2. Cartographie des invariants et écarts confirmés

| Domaine | État réel sur la baseline | Conséquence de cadrage |
|---|---|---|
| Souscriptions | `Subscription` porte `organizationId`, `planVersionId`, statut et dates, mais pas `productCode`. `PlanVersion` ne porte pas non plus de produit. L'index de souscription est organisation/statut/dates. | La résolution par produit exige une évolution additive et une compatibilité explicite : backfill historique vers `MONARQUE_CONNECT`, puis contraintes par produit après validation. Il ne s'agit pas d'une capacité déjà présente. |
| Entitlements / quotas | `OrganizationModuleActivation`, `OrganizationEntitlement` et `OrganizationQuotaUsage` sont organisation-scopés sans colonne produit. `EffectiveEntitlementsService.resolve` et `QuotaService` utilisent le resolver historique par organisation. | Le resolver sans `productCode` doit rester strictement Monarque Connect ; la nouvelle composition produit doit être explicite et empêcher les droits, suspensions et quotas de se contaminer. Cartographier et tester chaque lecteur avant migration. |
| Paiement | `PaymentRecord.invoiceId` est obligatoire et sa relation est tenant-scopée vers `Invoice`. | Toute vente réglée doit préserver l'Invoice canonique ; pas de PaymentRecord sans facture ni de nullable silencieux. |
| Frontière transactionnelle | `PaymentService.record`, `InvoiceService`, `CashMovementService.create` et `InventoryMovementService.create` ouvrent chacun leurs transactions Prisma. | Les méthodes publiques existantes ne peuvent pas être composées telles quelles dans la transaction POS unique prévue. C4 doit ajouter des opérations internes transaction-aware (ou un orchestrateur qui possède le `TransactionClient`) et conserver les validations centrales ; aucune transaction imbriquée présumée. |
| POS / API de commandes | Docs/114 nomme `ConfirmPosSale`, alors que la table de Docs/106 listait `PlaceCommercialOrder` et `CapturePosTender` comme commandes de règlement. | Contrat ambigu résolu dans Docs/106/105 : `ConfirmPosSale` finalise le POS local ; `CapturePosTender` est un port interne ; la commande online ne constate jamais un paiement ; PSP = intention durable puis finalisation après webhook vérifié. |
| Documents / fiscalité | Documents techniques, impression, stockage durable et homologation fiscale sont distincts. | G-07 est scindé en G-07T technique et G-07E externe. Aucun test technique ne vaut homologation ; aucun `COMMERCIAL_GO` sans preuve extérieure applicable. |
| Identité | `AuthPrincipal` contient `userId` et `sessionId` ; le contexte d'autorisation ajoute membership, rôle et scope organisation/établissement. | Les identités BUYER, staff, opérateur et agent doivent garder des politiques distinctes ; l'appartenance à une organisation ou la connaissance d'un identifiant ne donne aucun droit implicite. |

Références au SHA audité : `prisma/schema.prisma` (`PlanVersion:781`, `Subscription:1153`, `OrganizationModuleActivation:1425`, `OrganizationEntitlement:1453`, `OrganizationQuotaUsage:1472`, `PaymentRecord:2207–2224`) ; `src/entitlements/subscription.service.ts:79`, `src/entitlements/effective-entitlements.service.ts:64`, `src/entitlements/quota.service.ts:52,250` ; `src/sales/payment.service.ts:53,63`, `src/sales/invoice.service.ts:146,199,233`, `src/cash/cash-movement.service.ts:32,38,57,72`, `src/inventory/inventory-movement.service.ts:19,32` ; `src/auth/auth.types.ts:3–13`. Les numéros sont ceux du fichier à la baseline indiquée et doivent être recalculés après toute modification.

## 3. Décisions contractuelles à garder gelées avant migration

1. Un Core Monarque Connect et une seule source de vérité pour Sales, Invoice, Payment, Cash, Inventory et Event Fabric ; ZAMUREK n'accède qu'à des commandes/services Core typés, jamais directement au Prisma ou aux tables privées d'un autre domaine.
2. Portée produit explicite pour souscriptions, plans/offres, entitlements, quotas et opérations autorisées ; l'organisation reste le kill-switch de sûreté global. Le contrat historique Monarque Connect demeure compatible.
3. Flux POS et PSP définis dans Docs/106. `ConfirmPosSale` possède la transaction locale ; pas de réseau externe dans la transaction ; l'idempotence lie une clé à une empreinte canonique du payload économique.
4. Migration `expand → compatibilité/dual-read → backfill contrôlé → contraintes → bascule → contract différé`, avec sauvegarde synthétique, preuve de rollback/forward-fix et aucune réécriture destructive des historiques.
5. Les documents « reçus » ne sont pas réputés fiscalisés. Les règles et validations fiscales RDC, PSP réel, licences et approbations commerciales demeurent des gates externes distincts.
6. Le prix ZAMUREK BASIC de 7 USD/mois reste une hypothèse, non un prix publiable/seedable, tant que coûts, quotas, établissement(s), taxes, paiement et marge ne sont pas décidés.

## 4. Séquence avant de commencer le code

### Monarque Connect (d'abord)

1. Fusionner le cadrage #152 uniquement après relecture de ce rapport, cohérence des contrats et CI verte du commit PR ; maintenir l'issue #153 ouverte jusque-là.
2. Compléter C0 par une matrice vérifiable modèle/champ/contrainte/migration/lecteur/écrivain/risque/test, comprenant tous les chemins de souscription et d'entitlement et chaque service transactionnel appelé par POS.
3. Figer les contrats de C1–C7 : API/OpenAPI, propriétaires de commandes, identités, scopes, entitlements, signatures d'idempotence, événements et politiques d'erreur. Fermer explicitement les décisions métier encore ouvertes (règles de vente à crédit, stock/réservation, cash session, méthodes de paiement, acheteur public, territoire/devises et document imprimé) avant les migrations concernées.
4. Établir des migrations additives avec tests empty DB + upgrade à partir de la baseline `da0da727...`, sauvegarde/restauration synthétique et tests PostgreSQL de concurrence/isolation ; ne débuter chaque tranche métier qu'après son gate.

### ZAMUREK (après le chantier Monarque Connect, selon la séquence convenue)

1. Ne pas démarrer les clients Android/desktop ou une verticale sur des endpoints supposés. Attendre la fin du périmètre convenu côté Monarque Connect, puis un contrat d'intégration **public, versionné, minimisé et généré depuis OpenAPI Core**, avec commit source et tests de diff.
2. Remplacer les références de cadrage vers une branche/PR privée et mouvante du Core par ce contrat stable ; ne pas publier de schéma Prisma, implémentation propriétaire, secret ou donnée réelle.
3. Implémenter uniquement les façades/client SDK/UI et adaptateurs verticaux ; toute mutation financière passe par les commandes Core et l'identité/channel n'est jamais un droit.
4. Garder CI, tests contractuels, isolation multi-tenant et compatibilité client côté ZAMUREK indépendants ; synchroniser les versions de contrat explicitement, sans copie manuelle des modèles. Jusqu'à ce jalon, le dépôt ZAMUREK reste inchangé par cette séquence.

## 5. Verdict C0

**Baseline et écarts de code : documentés. Contrat POS : clarifié dans le cadrage. Migrations et E2E de baseline : prouvés par la CI #39787356963. C0 : pas encore accepté.** Il manque encore la matrice exhaustive des lecteurs/écrivains/contrats, une preuve synthétique de sauvegarde/restauration, les preuves de charge/performance requises, la validation des décisions commerciales/réglementaires applicables et la CI PR du nouveau commit documentaire. Garder C0 `IN_PROGRESS` jusqu'à production et revue de ces éléments. Aucun développement métier ne doit commencer avant le passage explicite du gate ; aucun changement n'est effectué dans le dépôt ZAMUREK pendant cette séquence Monarque Connect.
