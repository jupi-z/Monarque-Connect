# Phase 10A.5 — audit architectural C0 du Core réel

**Date de vérification : 27 octobre 2026**
**Baseline Monarque Connect :** `main@0df3c0934effa0fef42d7073b759f5758e8c831e`
**Baseline ZAMUREK :** `main@0ac6bbc2c00048335b4de88cc686e88247da783a`
**État :** audit du code réalisé ; **gate C0 NOT_ACCEPTED**. Aucun schéma ni code métier n'a été modifié par cet audit.

## 1. Résumé et preuves de référence

Le dépôt Monarque Connect fournit déjà un Core transactionnel riche, sous la forme d'un monolithe modulaire NestJS, Prisma et PostgreSQL. Il possède des modèles canoniques de ventes, factures, paiements, stock, caisse, événements et projections analytiques. Il n'existe cependant pas encore de partitionnement fonctionnel par produit, d'identité OIDC fédérée, de commande POS qui orchestre atomiquement ces domaines, ni de runtime d'agents partagé. Ces éléments restent des objectifs de la Phase 10A.5 ou de phases ultérieures.

La CI actuellement observée sur la baseline est le run [Backend CI #40394652453](https://github.com/jupi-z/Monarque-Connect/actions/runs/40394652453), sur le SHA indiqué ci-dessus : conclusion `success`. Les logs GitHub donnent 173 tests unitaires, 184 tests d'intégration PostgreSQL, 23 tests HTTP E2E, 54 migrations validées depuis une base vide et les upgrades historiques configurés, 200 opérations OpenAPI, lint, typecheck, contrats, build et smoke HTTP réussis. Ce sont des preuves du commit de baseline, pas des preuves du head révisé de la PR #152.

Le dépôt ZAMUREK est actuellement public également. Sa CI `push` sur `main@0ac6bbc2c00048335b4de88cc686e88247da783a` est verte : [run #39840078492](https://github.com/jupi-z/ZAMUREK/actions/runs/39840078492). La PR de cadrage [#2](https://github.com/jupi-z/ZAMUREK/pull/2) est ouverte, en brouillon ; son check `specification` a réussi sur l'ancien head `d74c60d2559bc9a56284905fbd6bcc07684c81fd` au run [#40109185297](https://github.com/jupi-z/ZAMUREK/actions/runs/40109185297). Les deux résultats sont distincts et ne valident pas de futurs changements documentaires.

Les dépôts sont accessibles publiquement (`visibility=PUBLIC`). Plusieurs textes qualifient pourtant Monarque Connect de dépôt privé ou présentent cette confidentialité comme une garantie. L'audit n'a changé aucun réglage GitHub. Les documents corrigés parlent désormais de frontière de propriété et de gouvernance, non d'une visibilité supposée. Le propriétaire doit confirmer séparément la visibilité souhaitée et revoir l'historique public, les secrets et les règles de contribution.

### État des branches de cadrage

- Monarque Connect PR #152 : ouverte, brouillon, head initial `3da05fd41aca61ac8bdc04d970803fe0b873577e`, base annoncée `a2a8d99723be1761ba3c46ecb504830a60e39828`. Son dernier check avant synchronisation était en échec : run #40109257225. Il avait exécuté 373 tests dans le premier passage puis 2 échecs sur 23 au passage E2E, sur un ancien merge ref et un runner auto-hébergé. Ces échecs historiques ne sont pas une preuve contre le `main` actuel ; leurs journaux ne permettent pas d'attribuer avec certitude une cause rétrospective.
- Une branche de travail séparée a fusionné `origin/main` dans le head de PR #152 avec un merge non destructif et sans conflit. Les branches locales préexistantes n'ont pas été écrasées. Après publication, le nouvel SHA et les checks PR devront être relevés ici ; le résultat de baseline ne s'y substitue pas.
- ZAMUREK PR #2 : ouverte, brouillon. Le check de spécification précédent est vert sur son ancien head seulement. La présente synchronisation corrige les assertions de visibilité erronées, sans implémentation runtime.
- Issue [#153](https://github.com/jupi-z/Monarque-Connect/issues/153) : ouverte. Elle doit rester ouverte tant que les décisions P0 et les preuves de récupération/performance ne sont pas acceptées.

## 2. Méthode et limites

Audit par inspection du code versionné sur le SHA `0df3c0934effa0fef42d7073b759f5758e8c831e`, des schémas, migrations, tests, OpenAPI, workflow actif et exécutions GitHub. Les tests lourds n'ont pas été relancés localement : le poste a un problème de refroidissement. Aucun runner auto-hébergé n'a été sollicité. Aucun test de charge, restauration réelle, audit légal/fiscal, test d'intrusion ou test PSP réel n'est revendiqué.

Les résultats marqués « existant » décrivent du code effectivement présent. Les cibles C1–C8 ne sont pas déclarées implémentées par la seule présence de documents ou de tests de fondation.

## 3. Cartographie du Core réel

| Domaine | Présent et réutilisable | Écart / compatibilité à préserver | Fichiers et preuves |
|---|---|---|---|
| Application | Monolithe modulaire NestJS, modules domaine importés par l'application. Pas de runtime microservice. | Garder les dépendances orientées services/ports ; pas de second Core ou Prisma commercial. | `src/app.module.ts`; modules `src/{auth,tenancy,sales,cash,inventory,billing,events,intelligence}`. |
| Identité | `User`, sessions refresh, memberships et rôles internes ; mot de passe et email normalisé. | Aucun mapping `issuer + subject` OIDC trouvé ; aucune fusion email automatique ne doit être ajoutée. Principals BUYER/AGENT/STAFF distincts non modélisés comme un contrat commun complet. | `prisma/schema.prisma` User et RefreshSession ; `src/auth/auth.types.ts:3-14`; `tests/auth/identity.test.ts`. |
| Tenant / autorisation | Membership actif, rôle, permission, entitlements, scope établissement revérifiés dans les parcours transactionnels. | Les extensions doivent continuer d'appeler `AuthorizationService`; un `channelId` client ne peut être une preuve d'accès. | `src/tenancy/authorization.service.ts:12-114`; tests `tests/tenancy/`, E2E inter-tenant. |
| Souscriptions / droits | CONNECT legacy, plans versionnés, activation par organisation, résolveur temporel et règles FairScale. | Pas de `productCode` dans Subscription, PlanVersion, activation, entitlement ou usage de quota. `resolveEffective(organizationId)` est implicitement mono-produit et doit rester strictement CONNECT. | `src/entitlements/subscription.service.ts:79-95`; `src/entitlements/effective-entitlements.service.ts:56-98`; modèles `PlanVersion:781-797`, `Subscription:1153-1169`, activation:1425-1469, quotas:1472-1488. |
| Billing SaaS | Tarifs/prix versionnés, termes commerciaux, paiements et renouvellements FairScale. | Billing SaaS Monarque Group est distinct des factures de vente tenant. Garder IDs et snapshots historiques ; aucun second moteur Billing. | `src/billing/`; `BillingSubscriptionTerm:1172-1206`; tests FairScale 9.5/9.6. |
| Sales / facture / paiement | Quote, SalesOrder, Invoice et PaymentRecord canoniques avec snapshots monétaires et références tenant-scoped. `PaymentRecord.invoiceId` est requis. | Pas d'orchestrateur POS atomique ; services de domaine ouvrent leurs propres transactions. Toute orchestration doit utiliser des primitives internes tx-aware, sans nested `$transaction` ni transaction réseau. | `prisma/schema.prisma`: Quote 2035-2062, SalesOrder 2091-2119, Invoice 2148-2178, PaymentRecord 2207-2232; `src/sales/payment.service.ts:53-90`, `invoice.service.ts:141-186`. |
| Cash | Ledger canonique, idempotence, audit/Outbox, devise et portée établissement. | Le mouvement net POS en espèces doit être créé dans la transaction de finalisation ; pas de ledger ZAMUREK concurrent. | `src/cash/cash-movement.service.ts:32-52`; `tests/cash/cash.integration.test.ts`. |
| Inventory / Purchases | Ledger de stock et projection de solde, transferts et intégration GoodsReceipt. | Les services possèdent aujourd'hui leurs transactions. C4 requiert une primitive orchestrable et un ordre de verrous établi, sans deuxième ledger. | `src/inventory/inventory-movement.service.ts:20-80`, `src/inventory/inventory-transfer.service.ts`; `src/purchases/`; tests inventory/purchases E2E. |
| Catalogue | `Item` tenant-scoped, référence de prix `Decimal(19,4)`, unité et suivi de stock. | Aucun système versionné complet Offer/Variant/Measure, taux FX, contexte de pricing ou policy de taxe multi-juridiction. Préserver les Items, devise par défaut et transactions existantes. | `prisma/schema.prisma:1809-1838`; tests referentials/Sales. |
| Événements | Outbox transactionnelle, enveloppe versionnée, worker avec receipts/leases/retries ; projections Intelligence idempotentes. | Les événements et tables source ne portent pas de `productCode`; définir l'évolution additive et minimiser les payloads. Pas de second bus. | `prisma/schema.prisma:615-649`; `src/events/prisma-outbox.writer.ts:4-27`; `src/intelligence/intelligence-projection.service.ts:86-116`; tests Outbox/Intelligence. |
| Intelligence / agents | Phase 10A: KPI/projections/metrics/alertes backend et consommation d'événements. | Aucun `src/ai` ou `src/agents`, ModelGateway, ToolDefinition ou runtime d'agent présent. Ne pas présenter C6 ou la Phase 10B comme livrée. | `src/intelligence/`; tests `tests/intelligence/intelligence-projection.integration.test.ts`. |
| Documents | Port `StorageAdapter`; adaptateur mémoire; démarrage production échoue si aucun adaptateur durable réel n'est configuré. | Impression POS et conservation durable restent dépendantes d'un stockage adapté ; pas de document fiscal certifié implicite. | `src/documents/storage-adapter.ts:14-20`; `src/documents/documents.module.ts:10-16`; tests Documents. |
| API | OpenAPI versionnée et contrôlée en CI, 200 opérations sur baseline. | Pas de contrat public minimal isolé ZAMUREK. Ne pas publier schéma Prisma, chemins internes ou contrôles privilégiés comme API partenaire. | `openapi/openapi.yaml`; scripts `scripts/validate-openapi*`; tests/contracts. |
| Migrations / CI | 54 migrations forward-only, preuve base vide et upgrades historiques dans CI hosted. | Aucun rollback SQL général ; il faut expand/contract et forward-fix/back-up/restore testés. Pas de preuve C0 de restauration ni de charge/soak. | `prisma/migrations/`; `.github/workflows/backend-ci.yml`; `.github/workflows/backend-ci-hosted-reusable.yml`; CI #40394652453. |

### Transactions des domaines existants

Les parcours `PaymentService.record`, `InvoiceService` et Cash/Inventory ouvrent leurs propres transactions. `PrismaOutboxWriter` sait écrire à travers une transaction transmise, mais les services publics actuels ne constituent pas tous des ports composables. La décision C4 est donc : introduire des opérations internes recevant `Prisma.TransactionClient` ou un port d'unité de travail contrôlé, et laisser une commande du domaine Core posséder la transaction unique. Ne jamais appeler PSP, imprimante, SMTP ou service distant dans cette unité de travail.

## 4. Matrice B-00 à B-09

| Invariant | Conformité observée | Écart et décision C0 |
|---|---|---|
| B-00 gouvernance / expand-contract | **Partielle** : migrations historiques et gates stricts déjà établis. | Pas de preuve rollback/restore universel. C1+ doivent ajouter nullable/default, backfill idempotent, contraintes après contrôle, déploiement en étapes et procédure forward-fix. |
| B-01 identité / Auth | **Partielle** : identifiants internes, membership et sessions existent. | Mapping OIDC absent ; pas de modèle fédéré issuer+subject. À concevoir de façon additive en C2, sans fusion email ni remplacement d'IDs. Types d'acteurs et MFA POS à arbitrer/contracter. |
| B-02 produits / entitlements | **Non implémenté, compatible comme cible** : actuel mono-produit CONNECT. | `productCode` absent des souscriptions, activation, usages, plans et événements. Ajouter scope produit serveur et contrainte d'un abonnement effectif par org/produit ; variante explicite du resolver; legacy sans argument reste CONNECT. Suspension org reste kill-switch global, suspension produit isolée. |
| B-03 POS transactionnel | **Non implémenté** ; les modèles financiers canoniques existent. | Aucun `ConfirmPosSale`/session POS. Les transactions séparées ne garantissent pas l'atomicité inter-ledgers. C4 doit créer la commande Core, conserver `PaymentRecord.invoiceId` non-null, append-only compensations et Outbox atomique. |
| B-04 prix / FX / fiscalité | **Partielle** : Decimal et snapshots de montants/devise existent. | Taux FX versionné et policy juridictionnelle absents. Les règles DRC/DGI et homologation ne sont pas prouvées. Prix, devise par défaut et historique actuels ne doivent pas être réécrits. |
| B-05 autorisations / tenant / canal | **Partielle** : authorization et scopes établissement existent. | BUYER/AGENT/canal produit ne sont pas un modèle partagé complet. Concevoir des principals et politiques distincts; vérifier tenant, produit, établissement et ressource côté serveur dans toute commande. |
| B-06 événement / idempotence | **Partielle** : Outbox et receipts idempotents présents. | `productCode` absent et certains services métier gèrent les clés séparément. Versionner l'enveloppe de manière additive; événements minimisés et idempotence sur payload canonique. |
| B-07 disponibilité / stockage | **Partielle** : modules et CI structurés ; adaptateur document mémoire et garde prod. | Restore synthétique, charge, p95/p99, RPO/RTO et stockage durable de déploiement non prouvés ici. Exiger des preuves opérationnelles distinctes avant C8/release. |
| B-08 contrat et compatibilité | **Partielle** : OpenAPI et contrats vérifiés dans CI. | Pas de contrat versionné produit/merchant publié; 200 opérations existantes sont le baseline. Contrats additifs, compatibilité N-1 et contract tests avant implémentation. |
| B-09 validation / sécurité | **Partielle** : CI hosted, PostgreSQL, E2E, lint, typecheck et scans usuels sur baseline. | Tests des propriétés futures inexistants; aucun test d'intrusion ou de charge n'est revendiqué. C1–C8 doivent ajouter tests négatifs et concurrency réels, sans alléger l'existant. |

## 5. Compatibilité à conserver

| Surface historique | Règle de compatibilité | Vérification avant/après chaque lot |
|---|---|---|
| API Monarque Connect | Aucun champ requis, code, statut HTTP ou permission existante ne change implicitement. Toute nouvelle forme structurante est versionnée. | OpenAPI diff, contrats, clients, E2E historiques. |
| Identifiants / tenants | Pas de changement d'ID user/org/establishment; clé composée et FK tenant-scoped conservées. | Décompte/backfill, contraintes, tests IDOR A/B et établissements. |
| Subscription / entitlements | `resolveEffective(organizationId)` demeure CONNECT et garde son comportement observable. | Golden contract tests, snapshots de résolution, tests dates/grâce et migrations de données. |
| Sales / Invoice / Payment | `PaymentRecord.invoiceId` reste obligatoire; factures/commandes/passés non réécrits. | Tests sommes, paiements, remboursements, versions et historique. |
| Cash / Inventory | Ledgers existants restent la source d'écriture; les soldes restent projections/reconstructions contrôlées. | Tests concurrence, idempotence, équilibre, audit et Outbox. |
| Événements | Noms et versions consommateurs existants sont conservés; ajout de champs optionnels ou nouvelle version compatible. | Consumer contract tests et rejeu des fixtures historiques. |
| Monnaies / docs | Aucun changement global de `defaultCurrency`, devise ou classification fiscale d'un document historique. | Décimales, snapshots, rendu et tests de lecture historiques. |

## 6. Frontières de produits

### Monarque Connect Core

Possède l'identité interne, tenancy, autorisations, catalogue partagé, transactions Sales/Invoice/Payment/Cash/Inventory, Billing SaaS, Audit/Outbox et contrats d'application. Le Core est un dépôt et une frontière de propriété technique. Sa visibilité GitHub actuelle est publique ; la propriété intellectuelle et la politique de publication sont des décisions de gouvernance distinctes. Aucun secret ni donnée tenant ne doit être publié.

### ZAMUREK

Doit contenir ses interfaces client et expérience métier verticale, configuration de canaux, presentation/UX mall, adaptateurs strictement nécessaires et code spécifique au marché. Il ne doit posséder ni deuxième moteur de facturation, ledger, catalogue maître, stock maître ou identité staff parallèle. Aucun code privé du Core ne doit être copié vers ZAMUREK. Le contrat d'intégration futur doit être publié comme artefact minimal/versionné; la visibilité publique de ZAMUREK impose que seuls les contrats explicitement approuvés y figurent.

### Monarque Auth

L'IdP authentifie et émet les claims OIDC; le Core mappe issuer+subject vers `internalUserId` et décide des memberships/permissions produit/tenant. Pas de rapprochement automatique par email. La disponibilité, le déploiement Keycloak et le protocole de migration des sessions ne sont pas livrés dans Monarque Connect à la baseline.

### Futurs produits et agents

`productCode` résolu côté serveur doit délimiter offres, droits, suspensions, quotas et contexte d'événement sans dupliquer les domaines transactionnels partagés. Les agents restent un client du Core via des outils versionnés, tenant-scoped, limités par policy et approbation; aucune action commerciale ou financière directe par accès Prisma ou secret d'agent.

## 7. Contrats à figer avant les migrations correspondantes

1. **Product context v1** : enum/registre serveur `MONARQUE_CONNECT`, `ZAMUREK`; les produits futurs ajoutés sans interpréter un code client libre. Portée explicite dans l'auth context, entitlements, quotas, suspensions, audit et événements.
2. **Resolver** : legacy `resolveEffective(orgId, at?)` reste alias CONNECT; ajouter `resolveEffectiveForProduct(orgId, productCode, at?)`. Pas de fallback silencieux ni `findFirst` ambigu. Réponse/version de capacité préservée.
3. **Identité** : table de liaison `(issuer, subject)` unique, référence interne stable, état, dates/audit; processus explicite d'association/révocation. Pas d'email comme clé de fusion.
4. **Actor/access context** : STAFF, BUYER, WALK_IN, AGENT, PLATFORM séparés; canal = donnée de routage; droits, tenant, establishment et capability de ressource évalués séparément.
5. **Commande POS** : `ConfirmPosSale` idempotente, portée org/établissement/produit/staff/session/terminal; une seule transaction Core écrit SalesOrder + Invoice + PaymentRecord + cash net si espèces + mouvements stock applicables + audit/Outbox. PSP passe par intention persistée puis preuve webhook et finalisation interne; impression après commit.
6. **PricingContext** : Item/Offer/Variant/Measure versionnés, `Decimal`, devise/policy/FX/source/date/taxe/arrondi snapshotés; devis expirables et prix calculé serveur. Les régimes fiscaux et prix commerciaux restent à validation métier/légale avant activation.
7. **Documents** : types internes commerciaux séparés des documents fiscaux officiels; stockage durable, checksum, version/rendu déterministe, reçu et impression hors transaction. Pas de revendication d'homologation non prouvée.
8. **EventEnvelope** : identifiant, type/version, tenant, acteur, source/aggregate, contexte produit, classification, occurredAt, payload minimal; outbox atomique avec mutation et consumers rejouables.
9. **API partenaire** : façade REST/OpenAPI versionnée et allowlistée; aucun partage direct de modèles Prisma ni identifiants privilégiés. Contrats d'erreur/idempotence/pagination et limites de données documentés.

Ces contrats sont des exigences de conception; ils n'autorisent pas à créer les migrations avant acceptation du gate C0 et l'approbation des décisions signalées en §11.

## 8. Migrations et stratégie de retour

Le dépôt contient 54 migrations jusqu'à `prisma/migrations/20261020164848_phase10a_intelligence_projections/migration.sql`. Les preuves CI démontrent migration depuis base vide et chemins historiques configurés; elles ne constituent pas une procédure de rollback.

| Lot | Évolution envisagée (non commencée) | Risque et stratégie |
|---|---|---|
| C1 | Product catalog / productCode pour plans, subscriptions, activations, quotas et policies. | Haut : backfill tous les enregistrements existants vers CONNECT, doublons de périodes, unique par org/produit. Expand nullable/default contrôlé, rapport de doublons, backfill idempotent, puis contraintes. Garder IDs. |
| C2 | Mapping OIDC et actor/access context; buyer capability éventuelle. | Haut : identité et accès. Nouvelle table additive, aucun remappage d'userId, liaison explicite et auditée; coexistence sessions. |
| C3 | Offer/variant/measure/pricing/FX/policy snapshots. | Haut : argent et historique. Tables versionnées nouvelles, ne pas réécrire Item/order/invoice; double-read limité et comparaison; anciens prix conservés. |
| C4 | POS session/terminal/orchestration/idempotency/provenance si nécessaires. | Très haut : cohérence financière/stock. Tables nouvelles; commande et ledgers canoniques; transaction/reversal testée; aucune contrainte nullable sur invoiceId. |
| C5 | Métadonnées de rendu/document et stockage réel. | Moyen-haut : disponibilité/conservation. Expand, migration des références par lot, checksum, restore; rollback conserve documents originaux. |
| C6 | Évolution EventEnvelope/policy ports et journaux d'approbation. | Haut : consommateurs historiques. Champs optionnels puis dual-read; version d'événement nouvelle, rejouabilité et déploiement consumer-first. |
| C7 | Façade API publique/merchant. | Moyen : compatibilité et exposition. Pas de migration sauf besoin démontré; version séparée, allowlist, tests tenant/produit. |
| C8 | Éventuelles contraintes/indices de performance après mesures. | Mesurer et ajouter concurrent indexes de façon contrôlée; sauvegarde et restauration synthétique avant contract/drop. |

**Protocole commun :** sauvegarde vérifiée; migration additive; déployer lecteurs tolérant l'ancien et nouveau; backfill reprenable avec compteurs/empreintes; valider invariants SQL; activer le nouveau chemin par flag serveur ciblé; vérifier métriques; contract seulement dans une release ultérieure. Pas de down migration destructive. En cas d'échec : désactiver le chemin, conserver les nouvelles colonnes/tables, restaurer la sauvegarde seulement selon procédure éprouvée ou appliquer un forward-fix. Preuve restore synthétique est exigée avant C8 et avant un release qui dépend de récupération.

## 9. Plan C1–C8 préparé, non implémenté

| Lot / PR | Dépendances | Portée et contrats | Vérification / acceptation / retour |
|---|---|---|---|
| C1 Product catalog & entitlements | C0 validé, choix product registry | Ajouter scope produit à catalogue/souscription/entitlements/quotas, backfill CONNECT, resolver explicite; aucun endpoint métier nouveau requis au départ. | Migration empty + production-shape synthétique, legacy golden tests, org multi-produit et suspensions indépendantes, concurrence abonnement, OpenAPI/contracts, rollback flag + forward fix. |
| C2 Identity & tenant principals | C0; C1 context interface figée | OIDC mapping, auth context, buyers/agents/staff séparés, resource capability, canal serveur. | issuer+subject, duplicate, revoke, email collision, IDOR tenant/establishment, sessions legacy, E2E auth; table additive et coexistence. |
| C3 Catalog/pricing/measure | C1/C2 contrats | Offer/variant/unit/policy/FX snapshots, calcul Decimal serveur; prix commercial et fiscal final soumis aux approbations. | property tests unités/arrondis/FX, devis expiré, prix historique, migrations et anciens Sales/Item, aucun nombre flottant. |
| C4 Atomic POS command | C1–C3 plus arbitrages POS/finance | `ConfirmPosSale`, session/terminal et primitives tx-aware; un seul owner de transaction et ledgers existants. | PostgreSQL atomicity, retries/replays divergents, concurrency, cash change/net, stock, PSP webhook late, rollback sans mouvement partiel, RBAC. |
| C5 Documents de vente / impression | C4; solution stockage durable choisie | Renderer commercial versionné, formats A4/58/80; reçu vs document fiscal; impression après commit. | binary/checksum/read/revoke/retry, formatting, tenant permissions, adapter production; gate réglementaire séparé. |
| C6 Shared event/agent ports | C0, identité et enveloppe d'événement approuvées | Contrats tools/gateway/policy/approval et product-aware event, sans runtime fournisseur imposé. | schema compatibility, consumer replay, no-tenant deny, approval pour action financière, outage IA n'affecte pas ventes. |
| C7 Merchant/public API | C1–C6 selon endpoints | Façade publique versionnée et minimale, séparée du backoffice staff. | contract snapshots, abuse/rate limits, BOLA/IDOR, tenant/product scope, data minimization, N/N-1. |
| C8 Release / preuve | C1–C7 | Compatibilité, migration, observabilité, récupération, SBOM et gates de release. | CI hosted PR + main, migrations base vide/upgrade, PostgreSQL/E2E/security/load ciblée, restore exercice, rapport et rollback contrôlé. |

Chaque lot est une ou plusieurs PR courtes avec contrats avant migrations, tests négatifs et positifs, état SQL après concurrence, CI GitHub-hosted sur SHA précis et post-merge. Ces critères sont une feuille de route; aucun lot C1–C8 n'a commencé dans cette mission.

## 10. Plan de validation réutilisable

- **Unités** : policies pures, périodes, Decimal, calculs tarifaires, mapping d'acteur, idempotency canonicalization.
- **Intégration PostgreSQL** : contraintes composées tenant/produit, concurrence sous transactions, verrous, outbox atomique, migrations et backfill reprenable.
- **E2E HTTP** : authentification legacy/OIDC coexistante, scopes établissements, séparation BUYER/STAFF/AGENT, erreurs, entitlements produit et compatibilité API.
- **Sécurité** : BOLA/IDOR inter-org/inter-establishment/inter-product, principals contrefaits, permission escalation, webhook forgé/rejeu, contenu personnel minimal.
- **Données/finance** : snapshots non modifiés, Decimal sans float, payment reversals append-only, absence de doublons cash/stock/Invoice et idempotency key divergente -> conflit.
- **Migration** : base vide, chaque état historique supporté, volumes synthétiques, interruption/reprise backfill, checks de cohérence avant contraintes, restaurer et comparer IDs/comptages/empreintes.
- **Résilience/performance** : panne worker/Outbox/LLM/stockage, retry bounded, charge représentative, p95/p99 et contention; aucun chiffre n'est déclaré avant mesure.
- **CI** : mêmes entrées npm et isolation tests fixées par CI stabilisation; GitHub-hosted seulement. Trois runs consécutifs ne sont exigés que lorsqu'un gate de phase le prescrit, et leurs SHA/runs doivent être cités.

## 11. Registre des risques et décisions à approuver

| ID | Décision / risque | État et propriétaire de validation |
|---|---|---|
| D-01 | Visibilité GitHub de Monarque Connect actuellement publique, malgré description privée précédente. | À confirmer par le propriétaire; aucune modification de visibilité faite. Contrôler secret scanning, historique et contributeurs avant toute décision. |
| D-02 | Modèle de relation org→produit et règles exactes de souscription/grâce/renouvellement. | Décision commerciale/produit requise avant C1; l'audit recommande product scope explicite additive. |
| D-03 | Fusion/association d'identités OIDC et méthode de preuve utilisateur. | Décision sécurité/identité avant C2; email seul explicitement insuffisant. |
| D-04 | Politique vendeur, caissier, cash session, annulation/remboursement et réservation de stock POS. | Décision opérationnelle/financière avant C4; le modèle conservateur de Docs/114 est proposition. |
| D-05 | Juridictions, taxes, arrondis légaux, document officiel et homologation RDC. | Validation par responsables compétents; aucune conformité fiscale revendiquée. Bloque activation commerciale concernée, pas les tests techniques synthétiques. |
| D-06 | Sources FX, cadence, autorité, fraîcheur, conservation d'un taux et politique de spread. | Décision commerciale et financière avant prix CDF/FX en production. |
| D-07 | Provider durable documents, rétention, résidence, sauvegarde et clés. | Choix d'exploitation avant C5/release; adaptateur mémoire interdit en production par garde existante. |
| D-08 | Récupération/restauration et objectifs RPO/RTO. | Aucun exercice de restore ou charge n'a été exécuté dans cet audit : `NOT_RUN`; preuve requise à C8. |
| D-09 | Contrat partagé publié et versionné Core↔ZAMUREK; politique de contribution aux deux repos publics. | Revue explicite avant génération/publish; aucune implémentation privée copiée. |
| D-10 | Agents, outils et approbation des actions financières. | Interfaces prévues uniquement; modèle de menace et approbateur humain à valider avant C6 runtime/Phase 10B. |

## 12. Écarts documentaires relevés et synchronisation demandée

Les documents de cadrage décrivaient Monarque Connect et ZAMUREK comme privés. Les métadonnées GitHub à la date ci-dessus indiquent `PUBLIC` pour les deux dépôts. Cette clarification ne change ni la propriété du Core ni son interface autorisée.

La PR #152 a été créée avant les corrections CI #156/#157; sa référence de base était dépassée et son échec historique venait d'un ancien merge commit. Elle a été synchronisée sur le main actuel sans conflit ni force-push. Le workflow actif de main est GitHub-hosted. Le runner auto-hébergé n'a pas été utilisé pour les vérifications de cette mission.

## 13. Verdict C0

**Audit du code : réalisé et documenté sur la baseline ci-dessus.**
**C0 gate : NOT_ACCEPTED / IN_PROGRESS.**
**GO pour fusionner les documents : non, jusqu'à revue des nouveaux checks et de la cohérence inter-dépôts.**
**GO pour démarrer C1 : NO-GO.**

Les lacunes produit/identité/POS/FX citées sont des fonctionnalités futures non présentes, et non des régressions du Core existant. Les conditions bloquantes avant C1 sont : (1) revue et CI de la PR #152 synchronisée, (2) validation des décisions D-01 à D-03 qui changent visibilité/frontière produit/identité, (3) contrat de compatibilité et de backfill CONNECT formellement accepté. La restauration, charge et gates d'exploitation restent requises pour C8; aucune preuve n'est inventée ici.

La baseline CI `success` ne valide que le main de référence. Aucun test local lourd n'a été exécuté, aucune CI postérieure au commit documentaire n'est revendiquée, et aucune CI du head ZAMUREK mis à jour n'est revendiquée. L'issue #153 doit rester ouverte jusqu'à ce que les prérequis et arbitrages ci-dessus soient résolus et vérifiés.
