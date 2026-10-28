# C3 — Résolution serveur des remises et du contexte fiscal

**Statut : contrat d'exécution pour C3.3.6+; ce document ne prouve pas encore une implémentation.** Les API, schémas et règles ci-dessous doivent être livrés et testés par petites PR. Aucune conformité fiscale n'est affirmée.

## 1. Objectif et limites

Les versions `PricingPolicyVersion` et `TaxPolicyVersion` existent, ainsi que le calcul Decimal et le snapshot immuable `PricingQuote`. À la baseline `main@ce7d9ae392db49419033dee959513f8da083208f`, `PricingQuoteService` refuse encore toute policy ayant des codes de remise ou de taxe. C'est le comportement sûr à conserver jusqu'à la livraison des résolveurs.

Ce contrat décrit uniquement la résolution côté serveur d'une cotation commerciale. Les remises de fidélité, coupons consommables, prix négociés, calcul multi-lignes, POS, facturation fiscale officielle et rapprochement comptable restent hors C3.

## 2. Classification fiscale explicite

### 2.1 Catégorie de l'offre

`CommercialOffer.taxCategoryCode` est nullable et tenant/product scoped par son offre. Il est renseigné uniquement par une commande explicite de classification utilisant `pricing:tax:manage`, avec `expectedVersion`, idempotence, audit et Outbox dans une transaction. Le code provient du serveur après validation du format; le client ne fournit jamais un taux, une exemption ou un montant de taxe à une cotation.

La catégorie est une configuration technique du tenant. Elle n'est pas déterminée par le nom/type d'Item et ne vaut pas classification juridique. Une offre sans catégorie ne peut pas produire une cotation quand une politique fiscale applicable est activée.

### 2.2 Contexte de juridiction

Ajouter un registre append-only `PricingTaxContextVersion`, scindé par organisation, produit et portée d'établissement. Une portée d'établissement nullable désigne le contexte par défaut du produit pour l'organisation; une portée d'établissement explicite surcharge ce défaut. Une cotation liée à un établissement résout d'abord la version de cette portée à `valuationAt`, puis le défaut de l'organisation. Sans portée effective, échec `422` lorsque la politique demande une taxe.

Chaque contexte porte un `jurisdictionCode` opaque et normalisé, un numéro de version, `effectiveFrom`, auteur, état DRAFT/ACTIVE, activation par OWNER/ADMIN, accusé explicite, hash de commande et provenance d'audit. Le code est saisi et approuvé par le tenant; il n'est ni déduit d'une adresse JSON ni présenté comme une juridiction légalement vérifiée. Pas de modification ou suppression d'une version active; toute correction crée une nouvelle version.

L'activation est contrôlée par verrouillage du scope et des contraintes SQL. Les périodes sont `[effectiveFrom, prochaine effectiveFrom)`; pour une même portée, les instants sont strictement croissants et uniques. Les versions établissement doivent référencer un établissement de la même organisation. Le contexte est filtré par produit et ne peut pas traverser les organisations.

### 2.3 Résolution des politiques fiscales

Les `taxPolicyCodes` de la `PricingPolicyVersion` effective constituent l'allowlist serveur des règles que cette policy peut appliquer. Pour chaque code, choisir la dernière `TaxPolicyVersion` ACTIVE dont `effectiveFrom <= valuationAt`. Ne retenir que les versions correspondant exactement au `jurisdictionCode` résolu et au `CommercialOffer.taxCategoryCode` serveur.

Si la liste est non vide, au moins une règle doit correspondre; sinon la cotation échoue fermée en `422`. Chaque règle configurée qui correspond est appliquée une fois. Les règles d'un même devis doivent partager `SOURCE` ou `TARGET`, conformément à la limite du calculateur V1; une combinaison mixte est refusée. Les versions, codes, taux, devises, juridiction, catégorie et mode sont inclus dans le snapshot. La prochaine prise d'effet d'un contexte ou d'une politique correspondante borne `expiresAt`.

Une liste `taxPolicyCodes` vide signifie uniquement qu'aucune taxe technique n'est configurée dans cette policy. Elle ne signifie pas « exonéré », « non applicable », ni conforme à une règle de droit. Toute évolution exigeant une déclaration juridique explicite appartient à un lot ultérieur et une validation compétente.

## 3. Remises commerciales V1

Créer `CommercialDiscountRuleVersion`, immuable et scindé par organisation/produit/code/version. V1 prend en charge uniquement une remise en pourcentage, avec un taux Decimal explicite dans `[0, 100]`, une date d'effet, un auteur et une provenance. Une correction crée une version future; aucune mutation/réactivation d'une version publiée.

Les codes de remise de la `PricingPolicyVersion` effective sont l'autorisation commerciale serveur. Chaque code sélectionne la dernière version effective à `valuationAt`; toute référence manquante ou sans version applicable refuse la cotation `422`. Toutes les règles retenues s'appliquent automatiquement à chaque ligne de devis couverte par la policy; aucun code de remise ni taux n'est accepté du client. V1 n'a pas de coupon, plafond par client, compteur de rachat ou ciblage d'acteur.

Chaque remise est calculée sur le sous-total source brut de la ligne, sans composition avec les autres remises, puis arrondie `HALF_UP` à la précision mineure de la devise source. Les montants des règles sont sommés et ne peuvent dépasser le sous-total; sinon la configuration est refusée `422`. Les taxes sont calculées après réduction. L'ordre canonique est l'ordre lexical des codes, et l'instant ainsi que chaque code/version/taux/montant sont snapshotés. Le taux maximal de 100% peut conduire à un total nul; un résultat négatif est impossible.

Une policy qui ne liste aucune remise n'accorde aucune réduction. L'ajout/suppression d'un code à une nouvelle version de policy modifie les devis futurs seulement; les snapshots existants ne sont jamais recalculés.

## 4. API et autorisations à livrer

- `POST /organizations/{organizationId}/pricing/tax-context-versions`: OWNER/ADMIN, `pricing:tax:manage`, produit explicite, portée établissement facultative, juridiction, effet futur/serveur, `Idempotency-Key`.
- `POST /organizations/{organizationId}/pricing/tax-context-versions/{id}/activate`: OWNER/ADMIN, `pricing:tax:manage`, accusé explicite, idempotence et audit.
- `PUT /organizations/{organizationId}/catalog/offers/{offerId}/tax-classification`: OWNER/ADMIN, `pricing:tax:manage`, catégorie ou effacement explicite, `expectedVersion`, idempotence. Le produit et l'établissement sont dérivés de l'offre côté serveur.
- `POST /organizations/{organizationId}/pricing/discount-rule-versions`: OWNER/ADMIN, `pricing:policy:manage`, code/version/taux/effet, idempotence.

Chaque mutation revalide produit, entitlements, membership et scope d'établissement dans la transaction. Elle écrit état, reçu d'idempotence, audit et Outbox atomiquement. Le payload d'Outbox ne divulgue ni prix, taux fiscal, catégorie sensible, juridiction ni donnée personnelle; il contient l'identifiant, le produit, la version et le hash de commande nécessaires au suivi.

## 5. Snapshot, concurrence et erreurs

Le snapshot quote inclut `taxContext` (version, portée, juridiction configurée), `taxCategoryCode`, les identifiants/codes/versions des politiques de remise et de taxe, leur base/devise, les montants calculés, les versions de pricing policy, prix, mesure et FX, ainsi que `calculationVersion`. Toute donnée monétaire reste une chaîne Decimal. Le snapshot ne contient pas de réinterprétation juridique.

La cotation verrouille les scopes de l'offre et des configurations temporelles pendant la résolution et la persistance. Les modifications concurrentes doivent donner une version déterministe ou un `409`; aucun devis ne mélange des versions prises à des instants différents. Rejeu identique retourne le snapshot existant sans consommer de compteur; rejeu divergent `409`.

| Situation | Résultat |
|---|---|
| Taxe demandée mais catégorie ou contexte absent | `422`, aucune quote |
| Taxe demandée mais aucune règle active correspondant exactement | `422`, aucune quote |
| Référence de remise non résolue ou combinaison > 100% | `422`, aucune quote |
| Produit/tenant/établissement ou permission refusé | `403`/`404` selon la convention existante |
| Référence idempotente avec payload divergent | `409` |
| Policy sans code de taxe/remise | Aucun calcul correspondant; aucune déclaration d'exemption |

## 6. Migrations et séquence

Migrations additives uniquement. Ne réécrire aucune migration fusionnée ni aucun snapshot historique. Les colonnes de classification restent nullables; le contexte et les règles ne reçoivent aucun backfill deviné. Vérifier base vide et upgrades supportés, FK tenant/product/establishment, unicité par portée, verrouillage concurrent, immutabilité SQL et nettoyage rollback/forward-fix.

Séquence cible:

1. C3.3.6: tax context versionné, classification d'offre, résolveur fiscal et snapshot.
2. C3.3.7: règles de remises en pourcentage, application déterministe et snapshot.
3. C3.4: révocation append-only des quotes, tests de sécurité/concurrence/non-régression, preuves de migrations, synchronisation documentaire et clôture C3.

Chaque lot exige OpenAPI/contrats, tests unitaires Decimal, tests PostgreSQL/E2E, migration base vide et upgrade, CI PR et CI post-fusion verte. Les tests lourds s'exécutent exclusivement sur runners GitHub-hosted tant que la contrainte matérielle locale n'est pas levée.

## 7. Ce que ce contrat ne prouve pas

Il ne prouve pas qu'une juridiction, catégorie ou règle fiscale est juridiquement exacte; il ne configure pas un fournisseur FX réel; il ne fournit pas de fiscalisation officielle, de remise marketing, de PSP, de parcours POS ou de commercialisation. Les décisions de paramétrage sont celles du tenant, clairement attribuées et auditables.
