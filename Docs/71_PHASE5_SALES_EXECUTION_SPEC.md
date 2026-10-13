# 71 — Spécification d'exécution Phase 5 — Sales

## Statut et autorité

Cette spécification ouvre la Phase 5 sur la baseline
`main@7ff4c54f18a49460585bba2e145e73f590cdfe16`, après la clôture vérifiée de
la Phase 4 CRM + Network. Elle est normative pour les contrats, les modèles,
les règles d'autorisation, les transitions et les preuves de livraison.

Le suivi GitHub est assuré par l'[issue #63](https://github.com/jupi-z/Monarque-Connect/issues/63).
La spécification n'introduit aucun code métier et ne constitue pas une
validation réglementaire ou fiscale propre à une juridiction.

## Objectif

Livrer la première chaîne transactionnelle de vente tenant-scoped :

`Quote → SalesOrder → Invoice → PaymentRecord`.

Chaque document doit rester compréhensible, recalculable, auditable et
rejouable sans réécriture silencieuse de l'historique.

## Périmètre de la phase

### Inclus

- devis et lignes de devis ;
- commandes client et lignes snapshotées ;
- factures et lignes snapshotées ;
- enregistrement d'encaissements constatés ;
- conversion idempotente devis accepté → commande ;
- conversion idempotente commande confirmée → facture ;
- paiements partiels et calcul de solde dû ;
- annulation explicite des documents non finalisés ;
- void contrôlé des factures non réglées ;
- corrections par écritures ou documents compensatoires explicites ;
- numérotation transactionnelle ;
- montants, devises et taxes techniques déterministes ;
- contrats OpenAPI, événements, audit, idempotence et preuves PostgreSQL.

### Hors périmètre

- processeur de paiement, carte bancaire, mobile money ou capture distante ;
- remboursement externe ou rapprochement bancaire ;
- avoir ou crédit fiscal réglementaire ;
- règles fiscales nationales, validation de numéro fiscal ou détermination de
  juridiction ;
- multi-devise avec conversion ou taux de change ;
- mouvements de stock lors du fulfillment, réservations de stock et
  expédition ; ces comportements relèvent d'Operations ;
- comptabilité générale, reconnaissance de revenu et clôture comptable ;
- facturation récurrente et abonnements clients ;
- hard delete d'un document transactionnel.

## Invariants non négociables

1. Toute opération privée suit l'ordre serveur :
   `tenant actif → membership actif → entitlement SALES → module SALES actif → permission → scope établissement`.
2. `organizationId`, `establishmentId`, rôle, plan, module ou prix fournis par
   le client ne constituent jamais une preuve d'autorité.
3. Quote, SalesOrder, Invoice et PaymentRecord portent
   `organization_id` et `establishment_id`; les parties et items référencés
   doivent appartenir au même tenant et être vérifiés dans la transaction.
4. Un membre `SELECTED_ESTABLISHMENTS` ne peut ni lire, ni modifier, ni
   agréger un document d'un autre établissement, y compris dans les listes,
   compteurs et conversions.
5. Une mutation effective écrit l'état, l'audit et l'événement Outbox dans la
   même transaction Prisma.
6. Une transition ou conversion est validée côté serveur, idempotente et sûre
   sous concurrence. Un retry effectif ne produit ni doublon, ni second audit,
   ni second événement métier.
7. Après émission, les snapshots de lignes, totaux, devise et numéro sont
   immuables. Une correction est une transition autorisée ou un document
   compensatoire explicite.
8. Les données privées de vente ne sont jamais exposées par les routes
   publiques Network et ne sont pas copiées dans les événements au-delà du
   minimum nécessaire.
9. `SALES` est le seul entitlement métier requis par les quatre agrégats de
   cette phase. Aucun service ne crée d'entitlement local.
10. Les montants sont calculés côté serveur avec précision et arrondi
    déterministes ; l'API sérialise les décimaux en chaînes.

## Entitlement, activation et permissions

Le module catalogue canonique est `SALES`. Toute route privée doit utiliser
`AuthorizationService.requireModule(..., 'SALES', permission)` et réutiliser
`EffectiveEntitlementsService`. Une capacité absente, suspendue, désactivée
ou hors scope produit un refus contrôlé sans fuite de l'existence du document.

Les permissions à ajouter à la matrice centrale sont :

- `sales:quotes:read`, `sales:quotes:write` ;
- `sales:orders:read`, `sales:orders:write` ;
- `sales:invoices:read`, `sales:invoices:write` ;
- `sales:payments:read`, `sales:payments:write`.

| Domaine | OWNER | ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|---:|
| Quotes read/write | ✓/✓ | ✓/✓ | ✓/✓ | ✓/– | ✓/– | ✓/– |
| Orders read/write | ✓/✓ | ✓/✓ | ✓/✓ | ✓/– | ✓/✓ | ✓/– |
| Invoices read/write | ✓/✓ | ✓/✓ | ✓/– | ✓/✓ | ✓/– | ✓/– |
| Payments read/write | ✓/✓ | ✓/✓ | ✓/– | ✓/✓ | ✓/– | ✓/– |

Le tableau fixe le droit métier ; le scope d'établissement reste obligatoire
pour chaque opération localisée.

## Modèle métier normatif

### Quote

Le devis contient au minimum : `id`, `organization_id`, `establishment_id`,
`number`, `party_id`, `status`, `currency`, `valid_until`, snapshots des
totaux, auteur et timestamps.

Une ligne contient : `line_index`, `item_id?`, `sku_snapshot?`,
`description_snapshot`, `unit_snapshot`, `quantity`, `unit_price`,
`discount_amount`, `tax_mode`, `tax_code_snapshot?`, `tax_rate?`,
`tax_amount`, `net_amount` et `gross_amount`.

Le lien `item_id` est informatif après création ; le snapshot est la source du
document. Un item ou une party désactivé ne peut pas être choisi pour un
nouveau devis, mais reste résoluble pour l'historique autorisé.

### SalesOrder

La commande reprend les snapshots du devis accepté ou peut être créée
directement par un membre autorisé. Elle contient `source_quote_id?`, unique
lorsqu'il est renseigné, ainsi que les mêmes informations de tenant,
établissement, party, devise, lignes et totaux.

### Invoice

La facture reprend les snapshots de la commande confirmée et contient
`source_order_id?`, unique pour la conversion Phase 5, `issued_at?`, `due_at?`,
`status`, totaux figés, `paid_amount` dérivé par les paiements valides et
`outstanding_amount` dérivé.

### PaymentRecord

Un paiement est un constat d'encaissement, pas une instruction de débit. Il
contient `invoice_id`, `amount`, `currency`, `method_code`, `reference?`,
`paid_at`, `status`, `recorded_by` et une éventuelle référence de reversal.

Les PaymentRecords sont append-only. Ils ne sont ni supprimés ni modifiés ;
une correction crée un reversal explicite lié au paiement d'origine et reste
dans la même devise. La somme nette des paiements valides ne peut jamais être
négative ni dépasser le total de la facture.

## Transitions et règles de correction

| Agrégat | Transitions autorisées | Règle de mutation |
|---|---|---|
| Quote | `DRAFT → SENT`, `SENT → ACCEPTED \| REJECTED \| EXPIRED \| CANCELLED` | Seul `DRAFT` est éditable ; `EXPIRED` est déterminé par `valid_until` ou une commande système idempotente. |
| SalesOrder | `DRAFT → CONFIRMED \| CANCELLED` | Seul `DRAFT` est éditable ; la confirmation fige lignes et totaux. `FULFILLED` est réservé à une future intégration Operations. |
| Invoice | `DRAFT → ISSUED`, `ISSUED → PARTIALLY_PAID \| PAID \| VOID`, `PARTIALLY_PAID → PAID` | Seul `DRAFT` est éditable ; `VOID` n'est autorisé que si aucun paiement valide n'existe. |
| PaymentRecord | `RECORDED → REVERSED` | Reversal append-only, idempotent et auditée ; aucun remboursement externe n'est exécuté. |

Les transitions terminales refusent toute transition inverse. Un document
annulé, rejeté, expiré, voidé ou un paiement reversé reste consultable selon
les droits et conserve son audit.

## Numérotation

La Phase 5 utilise une séquence transactionnelle par organisation, type de
document et année civile UTC :

- Quote : `Q-YYYY-NNNNNN` ;
- SalesOrder : `SO-YYYY-NNNNNN` ;
- Invoice : `INV-YYYY-NNNNNN`.

Le numéro est alloué dans la transaction de création, n'est jamais réutilisé
après émission et est protégé par une contrainte unique `(organization_id,
document_type, number)`. L'allocation utilise une ligne de compteur verrouillée
par PostgreSQL ; aucune garantie d'absence de trous n'est promise en cas de
transaction annulée, mais deux documents ne peuvent pas recevoir le même
numéro. La politique est organization-wide pour la Phase 5 ; une politique par
établissement reste une évolution explicitement versionnée.

## Calculs monétaires et taxes

- stockage PostgreSQL : `numeric(19,4)` pour les montants et `numeric(19,6)`
  pour les quantités ;
- API : chaînes décimales normalisées, jamais nombres flottants ;
- devise ISO-4217 en trois caractères majuscules, identique sur l'ensemble du
  document et de ses paiements ;
- calcul d'une ligne : `quantity × unit_price`, remise, puis taxe ;
- chaque étape monétaire est arrondie à quatre décimales avec une règle
  déterministe `HALF_UP` côté serveur ;
- le total du document est la somme des montants de lignes déjà arrondis ;
- une ligne doit avoir un montant net non négatif et une quantité strictement
  positive ;
- le client peut fournir un mode de taxe (`EXCLUSIVE`, `INCLUSIVE`, `EXEMPT`,
  `NOT_APPLICABLE`), un code et un taux décimal ; le serveur calcule et
  snapshotte les montants ;
- aucun code ne déduit une obligation fiscale, une juridiction ou une
  qualification réglementaire ; ces règles devront être ajoutées par une
  décision produit/juridique séparée avant une exposition correspondante.

La Phase 5 rejette toute devise différente de `Organization.default_currency`.
Elle n'applique aucun taux de change implicite.

## Contrat API-first

Le contrat autoritaire est `openapi/openapi.yaml`, sous `/api/v1` et avec les
erreurs Problem Details existantes. Toutes les opérations mutantes acceptent
`Idempotency-Key`.

Routes minimales à détailler avant implémentation :

- `GET/POST /organizations/{organizationId}/quotes` ;
- `GET/PATCH /organizations/{organizationId}/quotes/{quoteId}` ;
- `POST .../quotes/{quoteId}/send|accept|reject|cancel` ;
- `POST .../quotes/{quoteId}/convert-to-order` ;
- `GET/POST /organizations/{organizationId}/orders` ;
- `GET/PATCH /organizations/{organizationId}/orders/{orderId}` ;
- `POST .../orders/{orderId}/confirm|cancel` ;
- `POST .../orders/{orderId}/convert-to-invoice` ;
- `GET /organizations/{organizationId}/invoices` et `GET .../{invoiceId}` ;
- `PATCH .../invoices/{invoiceId}` avant émission ;
- `POST .../invoices/{invoiceId}/issue|void` ;
- `GET .../invoices/{invoiceId}/payments` ;
- `POST .../invoices/{invoiceId}/payments` ;
- `POST .../payments/{paymentId}/reverse`.

Chaque schéma doit documenter les champs obligatoires, les snapshots, la
pagination, les réponses de succès, `400`, `401`, `403`, `404`, `409`, les
erreurs d'idempotence, les exemples de montants sous forme de chaînes et les
conditions de transition.

## Audit et événements

Les mutations produisent au minimum les audit actions correspondantes et les
événements versionnés suivants :

- `sales.quote.created`, `sales.quote.updated`, `sales.quote.status_changed` ;
- `sales.order.created`, `sales.order.updated`, `sales.order.status_changed` ;
- `sales.invoice.created`, `sales.invoice.updated`, `sales.invoice.status_changed` ;
- `sales.payment_record.recorded`, `sales.payment_record.reversed`.

Chaque événement porte l'envelope canonique, `organizationId`,
`establishmentId`, acteur, agrégat, corrélation, request ID, classification
`CONFIDENTIAL` et un payload minimal. Les lignes complètes, notes privées,
credentials et données d'authentification ne sont pas recopiées dans l'Outbox.

## Idempotence et concurrence

- les commandes mutantes utilisent le mécanisme d'idempotence existant,
  scoped par organization, acteur et opération ;
- une même clé avec une charge différente renvoie un conflit ;
- les conversions ajoutent une contrainte unique sur la source ;
- les transitions utilisent une mise à jour conditionnelle ou un verrou de
  ligne et rechargent l'état dans la transaction ;
- la création de deux numéros concurrents est sérialisée par le compteur ;
- l'émission d'une facture et l'enregistrement d'un paiement verrouillent la
  facture afin de recalculer le solde sans dépassement ;
- deux paiements concurrents ne peuvent pas faire passer le solde sous zéro ;
- un retry d'une transition déjà appliquée renvoie l'état existant sans nouvel
  audit ni nouvel événement effectif.

## Migrations et preuves

Les migrations seront additives et devront prouver :

1. une base vide reconstruite depuis toutes les migrations existantes ;
2. un upgrade depuis la baseline Phase 4 (`main@7ff4c54…`) ;
3. les contraintes de tenant/établissement, unicité des sources et compteurs ;
4. les indexes de listes par organisation, établissement, statut et date ;
5. l'absence de donnée métier fictive dans le seed.

Un script dédié `npm run prisma:phase5:migration-proof` sera ajouté au moment
de l'implémentation et exécuté en CI avec PostgreSQL réel.

## Tests obligatoires

- contrats OpenAPI et sérialisation des décimaux ;
- calculs de lignes, remises, taxes explicites, arrondis et devise ;
- transitions autorisées, interdites et terminales ;
- quote accepté converti une seule fois en order ;
- order confirmé converti une seule fois en invoice ;
- paiement total, partiel, dépassement et reversal ;
- deux paiements concurrents sur la même facture ;
- deux créations concurrentes de documents et numéros distincts ;
- retry idempotent sans second audit/Outbox ;
- isolation entre tenants et établissements ;
- rôles insuffisants, membership suspendu, module absent/désactivé ;
- party/item hors tenant ou désactivé ;
- rollback état + audit + Outbox ;
- migrations base vide et upgrade Phase 4 ;
- non-régression complète des tests Phases 0 à 4.

## Gate de sortie

La Phase 5 ne pourra être déclarée terminée qu'après preuve effective de tous
les points suivants :

- modèle, transitions, calculs monétaires, taxes techniques et corrections
  validés ;
- entitlement, activation, permissions et scopes testés côté serveur ;
- OpenAPI détaillé, exemples et erreurs validés ;
- migrations base vide et upgrade depuis Phase 4 prouvées ;
- isolation tenant/établissement et refus négatifs prouvés ;
- audit + Outbox atomiques pour chaque mutation ;
- idempotence, numérotation et concurrence prouvées ;
- tests PostgreSQL et E2E verts ;
- CI PR et post-merge `main` verte ;
- statut, preuves, roadmap et issue #63 synchronisés ;
- branche de livraison supprimée après fusion.

## Décisions explicitement différées

Les points suivants ne doivent pas être inventés dans l'implémentation :

- conformité fiscale d'une juridiction donnée ;
- obligations de facture électronique ;
- retenues, exemptions ou régimes spéciaux ;
- prestataire et protocole de paiement ;
- remboursements et avoirs réglementaires ;
- règles de conversion multi-devise ;
- reconnaissance comptable du revenu.

Une demande sur ces sujets devra produire une décision métier/juridique
versionnée avant d'élargir le périmètre.
