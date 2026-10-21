# 101 — Phase 10A : Intelligence déterministe

**Statut : spécification normative retenue pour l’exécution Phase 10A.**

**Baseline examinée :** `main@26cf9c5e71d83674c2c8954f7c3eda00874293ea`.

**Suivi d’exécution :** [issue Phase 10A #141](https://github.com/jupi-z/Monarque-Connect/issues/141) ; [statut et gates](102_PHASE_10A_STATUS.md).

**Dépendances :** Phases 0–9 livrées ; fondations FairScale 9.5/9.6 intégrées techniquement. L’issue #123 reste ouverte pour les conditions externes de commercialisation et n’est pas une dépendance fonctionnelle de cette phase.

## 1. Objectif et sortie

La Phase 10A livre une première Intelligence opérationnelle déterministe : définitions versionnées de KPI, snapshots reconstruisibles, règles d’alertes explicables et API de tableaux de bord. Les résultats décrivent des données métier déjà enregistrées. Ils ne modifient jamais les faits métier, ne remplacent pas une comptabilité ou une décision humaine, et ne sont pas des conseils réglementaires.

Les calculs restent dans le monolithe modulaire et PostgreSQL. Les projections sont alimentées par les événements métier et peuvent être entièrement recalculées à partir des tables sources. Aucun broker, entrepôt analytique, cache distribué, fournisseur IA ou client graphique n’est ajouté.

La Phase 10B probabiliste demeure séparée. Aucun modèle, embedding, entraînement, recommandation probabiliste ou agent n’est inclus ici.

## 2. Invariants normatifs

1. Les tables métier existantes restent les sources de vérité ; `MetricSnapshot` et `InsightAlert` sont des projections dérivées, supprimables et reconstruisibles.
2. Chaque calcul applique d’abord l’organisation, l’adhésion active, l’entitlement `INTELLIGENCE_BASIC`, l’activation du module source, la permission de lecture source et le scope établissement.
3. Un `establishmentId` fourni par un client est validé côté serveur ; les données hors scope sont exclues avant agrégation et pagination.
4. Une métrique ne combine jamais des devises. Les montants sont retournés par devise ISO 4217 avec représentation décimale en chaîne, sans conversion ni taux de change implicite.
5. Les KPI sont définis dans un registre serveur versionné. Le client ne peut fournir ni formule, ni table, ni expression de filtre.
6. Les snapshots portent la version de définition, la date de calcul, la période, la devise et une provenance suffisante pour expliquer et reconstruire la valeur.
7. Les événements sont consommés au moins une fois ; les projections et transitions d’alertes sont idempotentes. Les événements tardifs déclenchent un recalcul depuis les tables sources, pas une addition aveugle de deltas.
8. Les payloads d’événements de métriques/alertes ne contiennent ni montants agrégés privés, ni détails de lignes, ni descriptions libres ; ils transportent des références et métadonnées minimales.
9. La panne ou le retard d’Intelligence ne bloque aucune écriture des domaines opérationnels.
10. Aucune agrégation identifiable ou benchmarking inter-tenant n’est exposé.

## 3. Architecture et flux

Le moteur comporte quatre composants internes :

- **Metric Registry** : codes, versions, type de valeur, sources, permissions, entitlements, grain temporel et fonction de calcul déterministe.
- **Projection Worker** : consommateur idempotent de l’Event Fabric ; détermine les périodes et dimensions affectées, puis recalcule les snapshots depuis les tables sources.
- **Rebuild/Reconciliation** : traitement interne relançable par organisation ou globalement, utilisé pour amorcer, réparer et vérifier les projections. Il ne crée pas d’accès public ni de mutation métier.
- **Intelligence API** : endpoints tenant-scoped qui lisent les projections et appliquent les politiques serveur. Une réponse expose `calculatedAt` et `sourceAsOf` ; aucune fraîcheur instantanée n’est promise avant mesure opérationnelle.

Lorsqu’un événement source compatible est consommé, le reçu du consumer et les écritures de projection sont validés dans une transaction PostgreSQL. Une répétition du même événement ne crée ni snapshot ni alerte supplémentaire. Si un événement requis n’existe pas encore dans un domaine, son ajout est additif : transition métier, événement versionné et outbox sont enregistrés dans la même transaction. Aucun contrat historique n’est renommé ou réinterprété.

Le rebuild relit les faits métier autorisés, remplace/upsert les clés de projection concernées et conserve une protection contre l’écrasement d’un calcul plus récent par un worker retardataire. Il ne relit pas l’Outbox comme journal comptable et n’en déduit pas seul l’état courant.

## 4. Modèle persistant proposé

### 4.1 `MetricSnapshot`

Snapshot unique par organisation, établissement éventuel, code/version de métrique, fenêtre ou instant de mesure, devise et dimensions normalisées. Champs minimaux : UUID, `organizationId`, `establishmentId?`, `scopeKey` non nullable (`ORG` ou `ESTABLISHMENT:<uuid>`), `metricCode`, `definitionVersion`, `periodStart?`, `periodEnd?`, `asOf?`, `valueDecimal?`, `valueJson?`, `currency?`, `currencyKey` non nullable (`currency` ISO 4217 ou `NONE`), `dimensionKey` non nullable, `calculatedAt`, `sourceAsOf`, `createdAt`, `updatedAt`.

Contraintes : exactement l’un des modes temporels est renseigné : fenêtre (`periodStart < periodEnd`, UTC demi-ouverte) ou instant (`asOf`), vérifié par `CHECK`. Deux indexes uniques partiels PostgreSQL distincts couvrent respectivement le mode fenêtre (`periodStart`, `periodEnd`) et le mode instant (`asOf`), avec `organizationId`, `scopeKey`, `metricCode`, `definitionVersion`, `dimensionKey` et `currencyKey`. Aucun champ nullable ne participe à la clé d’unicité. `scopeKey` évite les doublons d’établissement, `currencyKey` normalise l’absence de devise. Les calculs lisent les tables sources dans un snapshot cohérent `REPEATABLE READ`. Valeurs numériques exactes, jamais `Float`. Les snapshots d’une même clé sont upsertés, non historisés à chaque calcul ; les périodes passées sont conservées tant que les faits sources du tenant le sont et sont reconstruisibles après restauration. Une migration ne stocke pas de données sources privées redondantes.

### 4.2 `InsightAlert`

Projection d’alerte déterministe, avec UUID, organisation/établissement éventuel, `ruleCode`, `ruleVersion`, sévérité, statut `OPEN | RESOLVED`, `sourceType`, `sourceId`, `dedupeKey`, `triggeredAt`, `lastEvaluatedAt`, `resolvedAt?`, `payloadJson` minimal et timestamps. Un index unique partiel sur tenant + `dedupeKey` pour `OPEN` empêche les alertes ouvertes en double tout en conservant les occurrences résolues. Une nouvelle occurrence après résolution crée une nouvelle ligne. Les transitions sont idempotentes.

Les projections respectent les FKs composites de l’organisation et de l’établissement. Aucune ligne n’est modifiable par une API client.

Le grain persistant V1 des métriques `ACTIVITY` est la journée calendaire UTC, sous forme d’intervalles demi-ouverts `[00:00Z, lendemain 00:00Z)`. Les lectures sur une période regroupent ces journées selon le grain demandé (`DAY`, `WEEK` ou `MONTH`). Un événement tardif recalcule la journée métier affectée depuis les sources canoniques. Les métriques `CURRENT_STATE` ne sont pas converties en séries historiques et l’API ne promet que la mesure la plus récente.

## 5. Registre initial des KPI

Tous les intervalles demandés par l’API sont UTC et demi-ouverts. Les règles ci-dessous sont les définitions V1 ; elles ne constituent pas des écritures comptables.

| Code | Définition déterministe | Source et dimension |
|---|---|---|
| `SALES_ISSUED` | Nombre et total `totalGross` des factures actuellement non `DRAFT`/`VOID` dont `issuedAt` appartient à la période. Une facture annulée ultérieurement est exclue au recalcul, y compris de sa période d’émission. | `Invoice`; devise obligatoire ; établissement. Le total est une activité de facturation actuelle, pas un historique immuable ni un revenu comptable reconnu. |
| `PAYMENTS_RECORDED` | Flux net par `recordedAt` : enregistrement racine (`reversalOfId = null`) compté positivement, y compris s’il est ensuite passé à `REVERSED` ; enregistrement lié de reversal compté négativement dans sa propre période. Une reversal tardive ne réécrit donc pas le flux historique de la période du paiement initial. | `PaymentRecord`; devise et établissement. |
| `RECEIVABLES_OUTSTANDING` | État courant à `sourceAsOf` : pour chaque facture actuellement non `VOID`, `totalGross` moins les paiements racines et reversals liés dont `recordedAt <= sourceAsOf`; retourner la somme par devise. Aucun instant historique choisi par le client n’est accepté, car les sources ne conservent pas l’historique complet des transitions d’état de facture. | `Invoice` + `PaymentRecord`; établissement. Ne pas plafonner silencieusement les soldes négatifs. |
| `QUOTE_ORDER_CONVERSION` | Cohorte des devis créés dans la période dont le statut a quitté `DRAFT`; numérateur = devis de cette cohorte avec un `SalesOrder` lié, dénominateur = taille de la cohorte. | `Quote` + `SalesOrder`; établissement ; exposer numérateur, dénominateur et ratio, pas seulement le ratio. |
| `EXPENSES_RECORDED` | Nombre et somme des dépenses `RECORDED` par `expenseDate`; exclure `DRAFT` et `VOID`. | `Expense`; devise et établissement. |
| `CASH_BALANCE` | État courant à `sourceAsOf`, obtenu par somme signée des mouvements enregistrés jusqu’à cette mesure, `IN` positif et `OUT` négatif, incluant les corrections append-only selon leur sens. Aucun solde historique à date libre n’est promis en V1. | `CashMovement`; devise, établissement et compte. Ne pas agréger des devises différentes. |
| `INVENTORY_ON_HAND` | Quantité actuelle issue de `InventoryBalance`, sans addition entre unités différentes. | `InventoryBalance` + `Item` + `Warehouse`; établissement, entrepôt, article et unité. La valeur est un état à `sourceAsOf`, non une série historique. |
| `PURCHASE_ORDERS_PENDING` | État courant : nombre de bons de commande en `SENT`, `CONFIRMED` ou `PARTIALLY_RECEIVED`. | `PurchaseOrder`; établissement. Aucun montant d’achat n’est présenté comme dépense payée. |
| `PROJECTS_OVERDUE` | État courant mesuré à `sourceAsOf` : nombre de projets actuellement non `COMPLETED`/`CANCELLED` avec `dueOn` antérieur à la date UTC de mesure. Aucun historique de retard passé n’est déduit. | `Project`; établissement. |
| `CRM_PIPELINE` | État courant mesuré à `sourceAsOf` : nombre et somme des opportunités `OPEN` actives, groupés par devise ; valeur manquante exclue du total et comptée séparément. | `Opportunity`; établissement. Ce n’est pas une prévision probabiliste ni une série historique. |
| `NETWORK_INQUIRIES_CONVERTED` | Nombre d’inquiries de l’organisation liées à un lead ou une opportunité dans la période de création. | `NetworkInquiry` + lien de conversion tenant local ; aucune donnée du tenant tiers n’est agrégée ou exposée. |

Les montants et quantités sont agrégés avec l’arithmétique décimale exacte des sources et sérialisés respectivement à 4 et 6 décimales. Le ratio `QUOTE_ORDER_CONVERSION` est arrondi à 12 décimales, mode half-up, conformément à la précision de stockage de `MetricSnapshot.valueDecimal`; le numérateur et le dénominateur restent toujours exposés. Une cohorte vide ne produit aucun groupe de résultat (elle n’est pas artificiellement représentée comme un taux à zéro). Pour `CRM_PIPELINE`, une devise absente est groupée sous la dimension `NONE`; une valeur sans devise ou une valeur attendue absente n’entre pas dans la somme et est comptée dans `missingValueCount`.

Une métrique dont le module source n’est pas autorisé/actif ou dont la permission manque est omise de la réponse. Une demande explicite de cette métrique renvoie un refus standard sans révéler les enregistrements sous-jacents.

## 6. Règles et alertes initiales

Le premier registre met en œuvre uniquement les règles dont les sources disposent d’un signal explicite et vérifiable :

- `INVOICE_OVERDUE` : facture `ISSUED` ou `PARTIALLY_PAID`, montant restant positif, `dueAt` antérieur à la date UTC courante ; résolution au paiement complet, à l’annulation/void ou lorsque la date n’est plus échue.
- `PROJECT_OVERDUE` : projet actif non terminé/non annulé avec `dueOn` antérieur à la date UTC courante ; résolution à la fin, à l’annulation ou au changement de date.

Les deux règles ont la sévérité `WARNING` en V1. La sévérité est une constante de registre versionnée, pas une appréciation calculée par le client. L’évaluation porte sur l’état courant à `sourceAsOf` ; la V1 n’affirme pas à quelle date passée une facture ou un projet est devenu en retard.

Les alertes « stock sous seuil », « document proche d’expiration » et « RFQ sans réponse » sont prévues par `Docs/37`, mais leurs seuils/dates métier ne sont pas tous présents dans le schéma courant. Elles ne doivent pas être simulées à partir d’heuristiques. Elles restent inactives en 10A jusqu’à une décision contractuelle séparée et à l’ajout explicite des champs sources nécessaires. Cette phase peut les activer dans une PR ultérieure sans changer le format commun d’alerte.

Les payloads API d’alerte contiennent code, sévérité, statut, référence de ressource autorisée, dates, titre déterministe localisé côté client et données minimales de contexte. Pas de description libre, coordonnées de tiers, contenu de document ou dump ORM. Aucun endpoint de création arbitraire, de modification de règle, d’acquittement ou de suppression d’alerte n’est inclus en 10A.

Les ouvertures et résolutions persistées produisent les événements `intelligence.alert.opened.v1` et `intelligence.alert.resolved.v1`, enregistrés atomiquement avec la transition de projection. Le payload se limite à `alertId`, `ruleCode`, `ruleVersion`, `sourceType`, `sourceId` et `establishmentId?` selon classification `CONFIDENTIAL`.

## 7. Autorisation et isolation

Toute route exige l’ordre de contrôle standard : organisation active → membership actif → entitlement `INTELLIGENCE_BASIC` autorisé et module actif → `intelligence:read` → permissions du ou des modules sources → scope établissement.

La permission `intelligence:read` est ajoutée à la matrice des rôles tenant selon la ligne « Insights read » déjà prévue dans `Docs/07`. Elle n’accorde pas, à elle seule, la lecture de données sources : chaque KPI applique aussi sa permission source.

| KPI/règle | Module source | Permission source minimale |
|---|---|---|
| `SALES_ISSUED`, `RECEIVABLES_OUTSTANDING` | `SALES` | `sales:invoices:read` |
| `PAYMENTS_RECORDED` | `SALES` | `sales:payments:read` |
| `QUOTE_ORDER_CONVERSION` | `SALES` | `sales:quotes:read` et `sales:orders:read` |
| `EXPENSES_RECORDED` | `EXPENSES` | `expenses:read` |
| `CASH_BALANCE` | `CASH` | `cash:read` |
| `INVENTORY_ON_HAND` | `INVENTORY` | `inventory:read` |
| `PURCHASE_ORDERS_PENDING` | `PURCHASES` | `purchases:orders:read` |
| `PROJECTS_OVERDUE` | `PROJECTS` | `projects:read` |
| `CRM_PIPELINE` | `CRM` | `crm:read` |
| `NETWORK_INQUIRIES_CONVERTED` | `NETWORK_INQUIRIES` | `network:inquiries:read` |
| alertes | module de la ressource source | permission de lecture de la ressource source concernée |

Le filtre tenant et le scope établissement sont appliqués dans chaque requête d’agrégation et dans les lectures d’alertes avant tri, comptage et pagination. Les IDs directs d’alerte/snapshot hors tenant ou hors scope ne sont jamais révélés.

## 8. Contrat HTTP V1 à figer avant les migrations

Routes sous `/api/v1/organizations/{organizationId}/intelligence` :

- `GET /dashboard` — période requise, établissement optionnel, synthèse KPI autorisés, alertes ouvertes limitées, `calculatedAt` et `sourceAsOf` des projections.
- `GET /metrics` — liste filtrable par codes connus, `from`, `to`, établissement optionnel et grain `DAY | WEEK | MONTH` ; réponses décimales en chaînes et séries paginées/bornées.
- `GET /alerts` — filtres de statut/sévérité, curseur opaque et limite maximale 100 ; filtres appliqués après autorisation/scope.
- `GET /alerts/{alertId}` — détail minimal après validation tenant, permission source et établissement.

Règles communes : période maximale 366 jours pour séries, dates RFC3339 UTC, `from < to`, pagination keyset, aucune liste d’établissement fournie ne peut élargir le scope du demandeur, réponse avec `calculatedAt`/`sourceAsOf`, `403` pour accès non autorisé et `404` pour identifiant non visible selon les conventions existantes. Les métriques d’activité prennent `from`/`to` alignés sur des minuits UTC, conformément à leur projection journalière ; les métriques d’état courant sont mesurées à `sourceAsOf` et n’acceptent pas une date historique choisie par le client. Le registre expose le type `ACTIVITY` ou `CURRENT_STATE` ; aucun historique artificiel n’est généré pour `CURRENT_STATE`. Le contrat OpenAPI précis (schémas, exemples, codes d’erreur, paramètres) et tests contractuels précèdent tout code ou migration.

### 8.1 Contrat de réponse JSON

Le contrat V1 utilise les schémas OpenAPI `IntelligenceDashboard`, `IntelligenceMetricPage`, `IntelligenceMetricValue`, `IntelligenceAlertPage` et `IntelligenceAlert`. Une valeur de métrique expose `metricCode`, `definitionVersion`, `kind`, `calculatedAt`, `sourceAsOf`, `value`, ainsi que `period` uniquement lorsque la valeur représente une fenêtre d’activité et `dimensions` lorsque la définition l’exige. `kind` est strictement `ACTIVITY` ou `CURRENT_STATE`.

`value` est un objet typé par les champs applicables à la métrique : `count`, `amount`, `currency`, `numerator`, `denominator`, `ratio`, `quantity`, `unit` et `missingValueCount`. `amount`, `ratio` et `quantity` sont des chaînes décimales exactes, jamais des nombres JSON binaires. Le registre détermine les champs présents et leurs dimensions ; le client ne fournit aucune formule.

Le dashboard retourne `metrics`, `openAlerts` (maximum 20), `calculatedAt` et `sourceAsOf`. Les listes de métriques et d’alertes retournent `items`, `hasMore` et `nextCursor` nullable. Le curseur est opaque, borné à 2 048 caractères et lié au tenant, au scope, aux filtres, au tri et à la version du format ; sa validité contextuelle est vérifiée côté serveur. La limite de page par défaut est 20 et son maximum est 100.

Pour `/metrics`, `from` et `to` sont absents ensemble ou présents ensemble ; quand ils sont fournis, ils doivent être des timestamps RFC3339 terminés par `Z`, représenter des minuits UTC croissants et couvrir au plus 366 jours. Le dashboard exige ces deux timestamps. Un résultat `CURRENT_STATE` n’est jamais recalculé à une date passée sélectionnée par le client.

Les lectures dashboard, métriques et alertes appliquent l’entitlement `INTELLIGENCE_BASIC`, `intelligence:read`, les permissions et activations des modules sources, ainsi que le scope tenant/établissement. Un utilisateur peut voir uniquement les métriques et alertes correspondant à ses permissions sources ; un code demandé explicitement sans droit est refusé. La pagination des alertes est keyset et son curseur est lié au tenant, au scope, aux filtres et au tri ; les payloads privés des alertes ne sont pas exposés.

## 9. Entitlements, catalogue et activation

La phase réutilise le module `INTELLIGENCE_BASIC` et son entitlement FairScale. L’endpoint vérifie à chaque requête entitlement effectif et activation ; aucune permission n’est mise en cache côté client. Les snapshots d’un module source désactivé ne sont pas servis via l’API, mais leur suppression n’est pas automatique. Une suspension d’organisation bloque les routes conformément aux contrôles tenant existants.

La décision d’exposition commerciale de `INTELLIGENCE_BASIC` reste dans le catalogue/plans existants ; 10A ne s’octroie pas de droits de plan et ne modifie pas silencieusement FairScale.

## 10. Migration, événements et compatibilité

Les migrations sont additives et doivent réussir depuis une base vide ainsi qu’en upgrade depuis la baseline Phase 9.6. La Phase 10A ne modifie pas les lignes financières, statuts métier, documents historiques ou ledgers.

Les nouveaux événements nécessaires dans les domaines qui n’en publient pas encore suivent l’enveloppe de `Docs/43` et sont écrits via l’Outbox dans la transaction de la mutation source. Les consumers sont enregistrés par type/version dans l’Event Fabric existant. Le recalcul périodique de réconciliation couvre les événements manqués et rend une projection vérifiable depuis les faits actuels. Les écritures concurrentes sur une même clé sont sérialisées par contrainte/upsert PostgreSQL et une condition empêchant un calcul plus ancien d’écraser un `sourceAsOf` plus récent.

Les nouvelles tables utilisent FKs composites tenant/établissement, index tenant-prefixed, unicités d’idempotence/déduplication et montants `Decimal`. La migration ne crée ni table de données cross-tenant, ni champ de contenu métier dénormalisé.

## 11. Tests et preuves obligatoires

- Tests unitaires des 11 définitions KPI, règles de période UTC, devises, états inclus/exclus et sérialisation exacte.
- Tests PostgreSQL des upserts concurrents, déduplication d’alertes, reçus d’événements, ordre retardé, retry, rebuild et égalité entre projection et calcul source.
- Tests E2E HTTP : accès positif, autre tenant, non-membre, module non entitled/désactivé, permission source manquante, scopes établissement complet/sélectionné, ID d’alerte hors scope, dates invalides, période trop large, curseur réutilisé hors contexte et absence de fuite de champs privés.
- Tests d’invariance : événements dupliqués ne doublent ni valeurs ni alertes ; une transition métier source n’attend pas le worker ; arrêt/reprise du worker converge ; rebuild ne modifie aucun enregistrement métier.
- Tests de contrat OpenAPI et compatibilité ; tests de migrations base vide + upgrade Phase 9.6 ; tests non-régression des phases précédentes.
- Preuves de CI PR et post-fusion sur `main`, avec compte des tests, migrations et opérations OpenAPI dans un document de clôture 10A.

## 12. Séquencement obligatoire

1. Spécification, matrice métrique/permissions et écarts de source gelés dans ce document.
2. Issue Phase 10A #141, statut, roadmap et tracker synchronisés.
3. Contrats OpenAPI et tests contractuels, sans migration métier.
4. Modèles/projections et migrations additives avec preuves base vide/upgrade.
5. KPI et consumers par groupes de domaines, tests PostgreSQL et HTTP à chaque PR.
6. Règles d’alertes initiales, routes de lecture, E2E sécurité et reconstruction.
7. CI GitHub PR et post-fusion, preuves et clôture technique 10A.

Chaque tranche utilise une branche dédiée, une PR et des contrôles CI verts ; aucun push direct sur `main`. Une phase n’est terminée qu’après ses gates et preuves post-fusion. La clôture technique de 10A ne valide ni le lancement commercial FairScale ni la Phase 10B.

## 13. Écarts connus à la baseline

- Les modèles `MetricSnapshot`, `InsightRule` et `InsightAlert` sont décrits dans des documents d’architecture, mais ne sont pas présents dans `prisma/schema.prisma` à la baseline.
- Aucun contrôleur Intelligence ni permission `intelligence:read` n’est actuellement implémenté ; la matrice `Docs/07` annonce déjà la lecture Insights pour les rôles tenant.
- L’Event Fabric existant n’a pas encore de consumer métrique ; plusieurs domaines métier ne publient pas les événements nécessaires à une projection événementielle exhaustive.
- Les seuils de stock bas, dates d’expiration documentaire et dates limites de réponse RFQ sont absents ou incomplets ; aucune heuristique ne peut les remplacer.
- `Docs/93` conserve des mentions de gates techniques 9.6 antérieures à la fusion corrective #140. Leur actualisation est documentaire et n’altère pas les conditions externes de l’issue #123.

Ces écarts sont traités explicitement dans le plan 10A ou dans des décisions séparées avant leur implémentation. Aucune refonte des Phases 0–9 n’est autorisée.
