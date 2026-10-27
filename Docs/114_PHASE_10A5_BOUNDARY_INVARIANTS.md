# 114 — Invariants normatifs des frontières du Core partagé (Phase 10A.5)

**Statut : D-01 à D-10 acceptées par le propriétaire pour l'architecture et le séquencement.** Les capacités C1–C8 / 10B–12 ne sont pas implémentées par ce document. Aucune migration, API ou aptitude à la production n'est acquise du seul fait de ce texte. Les phases 0–10A et FairScale 9.5/9.6 conservent leurs contrats existants.

La vérification de la baseline et les écarts du code avant migration sont consignés dans [Docs/115 — audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md). Les APIs et modèles futurs restent `PLANNED` jusqu'à leur implémentation et leurs tests. Baseline auditée : `0df3c0934effa0fef42d7073b759f5758e8c831e`. L'acceptation documentaire C0 attend fusion et CI post-fusion.

## B-00 — Gouvernance du changement et ordre d'exécution

1. Monarque Connect demeure **seule source de vérité transactionnelle** pour les opérations commerciales et financières et conserve le monolithe modulaire NestJS/Prisma/PostgreSQL. Les verticales ZAMUREK sont des modules isolés, appelant des *application services/commands* typés ; pas de deuxième ERP, ledger, copie de schéma ou ORM marchand. Un module nouveau n'accède pas directement via Prisma aux tables d'un autre domaine ; l'orchestration transactionnelle est possédée par un service du Core et ses ports internes. Les accès historiques existants sont inventoriés en C0, pas réécrits aveuglément.
2. **Expand → dual-read/compatibilité → bascule contrôlée → contract différé**, jamais migration big-bang. Nouveaux champs nullable/default pour anciens enregistrements ; backfill idempotent, contrôle de complétude, contraintes ajoutées après validation ; rollback applicatif ou procédure forward-fix documentée. Conserver clés, numérotation, montants, historiques et APIs 0–10A.
3. Chacune des décisions B-01 à B-09 est **P0 et bloquante avant la première migration du domaine concerné** ; C0 doit produire une matrice code réel ↔ modèles ↔ migrations ↔ risques ↔ tests, notamment les appels utilisant `SubscriptionService.resolveEffective`, `EffectiveEntitlementsService.resolve`, `PaymentRecord.invoiceId`, `Invoice`, `CashMovement` et `AuthorizationService.requireModule`. Aucune création de schéma sans preuve de non-régression.
4. Les PR restent petites, indépendamment vérifiables, CI verte sur branche et sur `main` après fusion. Aucun déploiement, émission fiscale, PSP réel, secret ou donnée client réelle autorisé par ce document.

## B-01 — Identité, acteurs et futur Monarque Auth

- **Monarque Auth** est la cible de fédération OIDC/OAuth2, avec Keycloak évalué/retenu comme moteur interne prioritaire dans ce projet distinct. Cela **ne signifie pas** que Monarque Connect utilise déjà Monarque Auth ou qu'une migration de comptes a été réalisée.
- Le Core reste propriétaire des `organizationId`, `establishmentId`, memberships, rôles, entitlements, policies métier et audits. L'IdP externe/futur émet et vérifie l'authentification ; il ne décide jamais directement d'un accès à SALES/CASH/POS. Prévoir un `IdentityProviderPort` et un mapping durable `issuer + subject -> internal userId`, avec uniqueness, révocation/désactivation, auditable et aucune fusion automatique par simple e-mail.
- Distinguer les principals **STAFF**, **BUYER**, **WALK_IN** (pas de principal acheteur : caissier STAFF identifié), **AGENT** et **PLATFORM**. Un BUYER peut consulter seulement ses ressources après preuve de propriété ou capability serveur liée à l'objet, à durée limitée et révocable ; il ne reçoit jamais un `OrganizationMembership` staff par checkout. Un claim de canal, `channelId` ou `X-Zamurek-Channel` est une information de routage non une autorisation.
- Checkout en ligne avec identité client authentifiée/confirmée selon politique et vérification d'e-mail ; POS de passage sans compte acheteur. MFA renforcée et session terminal pour opérations de caisse ; le client Windows/VPN ne remplace ni les autorisations serveur ni les contrôles anti-rejeu.
- Migration future IdP par stratégie de coexistence/versionnement des sessions, mappings explicites et tests de non-régression, jamais remplacement unilatéral des `userId` ou des tokens en cours.

## B-02 — Abonnements, produits et entitlements sans contamination

- Ajouter un identifiant de produit **stable, côté serveur** : `MONARQUE_CONNECT` pour l'existant (backfill explicite), `ZAMUREK` pour le nouveau. Conserver tous les identifiants de `Subscription`, `PlanVersion`, `BillingSubscriptionTerm` et les contrats Billing existants. Ne pas créer un deuxième moteur de facturation SaaS.
- Cible : au plus **un abonnement effectif par couple (organizationId, productCode)** dans une fenêtre temporelle ; chevauchement entre produits **autorisé**, chevauchement à l'intérieur d'un même produit **interdit**, y compris sous concurrence (exclusion/contrainte PostgreSQL), conformément aux statuts effectifs et règles de grâce du produit. Les renouvellements/replays sont idempotents et la politique d'annulation n'altère pas l'autre produit.
- L'ancienne signature `resolveEffective(organizationId)` et l'ancienne projection `capabilitiesVersion=1` restent **strictement Monarque Connect** pour les clients existants ; ajouter des variantes explicitement product-scoped (version 2 si forme de réponse modifiée). Aucun `findFirst` par organisation seul ne peut décider implicitement quel produit est actif. Auditer les requêtes et contraintes existantes.
- `Organization.status` reste un **kill-switch global de sûreté/tenancy**. Suspension commerciale du produit A bloque ses seules capacités, **pas** le produit B. Les overrides, activations, quotas et dépendances doivent porter une portée produit explicite ; `ALLOW` ne peut jamais court-circuiter une interdiction produit, une restriction staff/BUYER ou une suspension globale. Shared `Sales/Cash/Catalog` sont des **capacités ciblées par opération** et contexte produit, non des droits illimités au module ERP.
- Exemple obligatoire : ZAMUREK_BASIC donne `pos:sale:write` et `pos:tender:cash` dans son scope autorisé, mais **pas** `crm:write`, `purchases:write`, `cash:transfer`, lecture générale du grand livre, ni permissions OWNER; un client possédant les deux offres reçoit la **composition bornée** des droits, sans mélange de quotas.
- Le prix ZAMUREK **7 USD/mois/org** est une hypothèse ; ne pas seeder comme prix commercial activable avant calcul de marge, établissement(s) inclus, quotas, taxation, consommation IA, modalités de paiement et approbation distincte.

## B-03 — Commandes POS, règlement et documents financiers

- Conserver `SalesOrder`, `Invoice`, `PaymentRecord`, `CashMovement` comme **agrégats financiers canoniques** ; aucune table de règlement ZAMUREK concurrente. `PosTerminal`, `CashSession`, `PosSale`, `SaleTender` sont extensions d'orchestration/provenance, pas un second ledger.
- **Choix V1 conservateur** : toute vente POS effectivement encaissée crée/réutilise dans la même transaction **SalesOrder + Invoice canonique + PaymentRecord lié à Invoice** et, si espèces, **CashMovement** associé ; numéro et snapshot garantis. **`PaymentRecord.invoiceId` reste non-null et invariant existant**, pas de migration nullable/cible alternative implicite. La facture interne de règlement et le **document fiscal légal** sont des notions distinctes : le renderer classe `RECEIPT` vs `TAX_INVOICE` selon la politique/juridiction vérifiée. Ne jamais présenter un reçu simple ou une facture interne comme facture normalisée DGI.
- Si l'analyse réglementaire interdit même cette facture interne pour un scénario, le scénario POS concerné reste **bloqué** ; toute autre modélisation (paiement directement lié à l'ordre) demande un ADR et la revalidation de Sales, receivables 10A, reversals et exports avant code.
- Le service applicatif public `ConfirmPosSale` possède la transaction interne unique et réutilise les règles/ports Sales/Invoice/Payments/Cash/Inventory ; `CapturePosTender` est une sous-opération interne et n'est pas exposée comme commande autonome. Il interdit tout appel PSP, impression ou réseau distant **dans la transaction PostgreSQL**. Paiements électroniques externes : intention durable + vérification du webhook signé + finalisation transactionnelle à réception, jamais succès sur simple capture client. `PlaceCommercialOrder` initialise un ordre online/différé mais ne constate pas l'encaissement.
- La transaction persiste les obligations financières, réservations/consommations de stock applicables, receipt de commande idempotent, audit, Outbox et relation source, puis retourne un résultat canonique. Définir exactement le moment de reconnaissance du règlement et les conséquences d'une caisse sans stock disponible. Retry/concurrence = **un seul** order, invoice, payment et mouvement net cash avec même clé/payload ; même clé/payload divergent = conflit. Revalidate staff, établissement, session, terminal, droit produit et stock **dans** la transaction avec verrouillages ordonnés.
- Espèces : `amountDue` est la somme due, `amountTendered` le montant remis, `changeDue = amountTendered - amountDue`. Pour un tender 10 000 CDF sur 5 900 CDF dus, **4 100 CDF rendus** et **mouvement de caisse net entrant de 5 900 CDF** ; l'audit du tender conserve remis/rendu. Si les politiques de journal physique imposent deux mouvements bruts, un ADR supplémentaire spécifie la correspondance et garantit le même net, jamais une double recette. Bilans par devise, précision Decimal sans float.
- Les paiements mixtes/manuels restent derrière capacité et preuve de règlement selon le mode ; transferts non confirmés ne créent pas de `PaymentRecord` considéré payé. Remboursements/annulations par compensations append-only et rapprochement.
- `CashSession` et `PosTerminal` vérifiés (ouvert, actif, établissement, caissier/permissions). Une session est fermée une seule fois, avec fonds initial, résultat théorique, comptage, écarts et approbation hiérarchique si nécessaire. Un ticket réimprimé n'émet jamais une deuxième vente.

## B-04 — Tarification, mesures, FX, fiscalité

- Les organisations et transactions Monarque Connect déjà créées conservent `defaultCurrency`, les montants, numéros et snapshots. Aucun changement global vers USD ou CDF. Les `Item` canoniques sont étendus par `Offer/Variant/Measure/PricingContext` versionnés ; les modules spécialisés n'inventent pas de deuxième catalogue.
- Chaque prix accepté est obtenu par calcul **serveur** (Decimal/arithmétique entière appropriée), version de politique, taux FX sourcé/daté, taxe/arrondi/juridiction et snapshot immuable associé au devis/ordre et à chaque document. Le client ne peut ni fixer un taux, ni changer le total, ni prolonger un devis expiré. Provenance et contrôles de fraîcheur obligatoires.
- Exemple invariant : `0,125 kg × 20 USD/kg × 2360 CDF/USD = 5900 CDF` sans nombre flottant ; changement ultérieur du taux ne réévalue pas la commande émise. Séparer le taux de conversion, les arrondis monétaires et les règles de taxe.
- Fiscalité par pays/juridiction et type marchand/document : `UNKNOWN` ou licence/fournisseur non vérifié => blocage de l'**émission nécessitant une fiscalisation**, sans QR, numéro ou libellé officiel simulé. La recette technique peut employer des jeux synthétiques, pas les présenter comme preuve juridique RDC.

## B-05 — Permissions POS et cloisonnement utilisateurs/acheteurs/agents

- Ne pas attribuer `ADMIN`, `FINANCE` ou `cash:write` générique à un caissier comme raccourci. Définir des permissions d'action dédiées `pos:sale:create`, `pos:tender:cash`, `pos:session:open`, `pos:session:close`, `pos:refund:request`, `pos:refund:approve`, `pos:reports:read`, mappées à un rôle staff POS versionné dans la policy Core. Le principal staff détient une portée d'établissement et de terminal/session ; à chaque commande, droit module **et** produit **et** rôle **et** ownership **et** règles opérationnelles.
- Le Core opère les écritures Sales/Payments/Cash derrière un command handler privilégié **scopé à la seule opération déjà autorisée**, pas via un token super-admin, rôle implicite ou contournement des garde-fous.
- BUYER seulement lecture/écriture de ses propres commandes et profils via guards séparés ; aucun endpoint de règlement staff, aucune API de listing tenant, aucun accès plateforme. Statuts 404/403 minimisent les fuites d'existence d'objet. Venue/mall ne voit que listings opt-in et ne lit ni commandes ni fonds du commerçant.
- Pour les AGENT, classes A0–A4 existantes ; pas d'accès SQL, pas de paiement/retour/fiscalisation autonomes. A3 : proposition signée/identifiée, payloadHash, TTL, approbateur habilité distinct, revalidation au moment du commit, idempotence, audit et kill-switch.

## B-06 — API, événements, compatibilité et isolement des domaines

- Source de vérité : `openapi/openapi.yaml` et contrats de Monarque Connect ; le dépôt public ZAMUREK consomme des **projections publiables minimales** versionnées avec SHA provenance, jamais le schéma interne complet ni secrets. Le backend expose une façade distincte buyer/public et les endpoints staff sont gardés ; `/api/v1` demeure préfixe canonique.
- Pour les API clientes déployées : additif par défaut ; breaking change seulement par version majeure, avec fenêtre de compatibilité annoncée, test ancien SDK/APK/EXE et procédure de migration. Contract diff automatique Core↔SDK et test de compilation de clients.
- Tout message Outbox a `organizationId`, produit/canal de provenance et établissement lorsque pertinent ; version d'événement, classification et PII minimisée. Les consommateurs existants restent compatibles ; rejouer le même événement ne duplique ni money movement, ni stock, ni abonnement.
- Quotas, throttling, files de traitements, projection et audit sont **product- et tenant-aware**, pour éviter qu'un gros tenant ou la charge ZAMUREK ne dégrade tous les services. Aucune promesse de scalabilité sans benchmark mesuré.
- PostgreSQL V1 partagé : contraintes/FK composites organisation + établissement sur les nouvelles entités, ownership acheteur au niveau objet, filtres/guards server-side, cas adversariaux BOLA/IDOR; RLS éventuelle seulement après protocole d'identité transactionnelle vérifié avec Prisma/connexions poolées, jamais `SET` de session non maîtrisé.

## B-07 — Disponibilité, maintenance, stockage documentaire et production

- Le runtime commerce **n'appelle jamais un LLM pour autoriser ou finaliser** un paiement, un stock, un prix ou une facture. Gateway IA, assistants, impressions et discovery sont désactivables indépendamment par produit et par tenant. Défaillance IA ≠ défaillance caisse.
- Le seul `MemoryStorageAdapter` actuellement câblé pour Documents est développement/test et empêche le boot en production. **C5 ne peut être déclaré opérationnel ou production-ready avant un véritable adaptateur stockage durci**, chiffré, avec contrôle d'accès, checksum, rétention, quota, scan si pertinent, sauvegarde/restauration et tests d'expiration/révocation. L'impression locale est asynchrone après commit et n'annule pas la vente en cas d'échec papier.
- Dès C0, définir SLO/SLA *cibles mesurables* et charges représentatives par tenant, POS, org et produit ; mesurer latences p95/p99, transactions/s, pools DB, contention, taille des tables/index, temps de migration, backlog Outbox, restauration et coût/tenant. Ne pas déclarer « ultra scalable » avant tests de charge, capacité et soak. Optimiser d'abord indices, bulkheads, pagination et traitements batch, sans basculer en microservices préventivement.
- Les sauvegardes chiffrées et le **restore effectif** doivent vérifier l'isolation : restauration globale et export/portabilité tenant (y compris liens documents) ; pas de restauration sélective « garantie » si les relations multi-tenant ne le permettent pas encore.
- Garder trois décisions distinctes : `CORE_TECHNICAL_ACCEPTED`, `MONARQUE_CONNECT_COMMERCIAL_GO`, `ZAMUREK_COMMERCIAL_GO`. CI, E2E et migrations ne constituent ni une homologation fiscale, ni un PSP en production, ni une validation juridique.

## B-08 — Gate de recette et ordre des tâches

**Avant C1/C2/C3** : C0 signe la cartographie des primitives et les décisions B-01/B-02/B-03/B-05 ; tests de baseline existants verts sur SHA précis. Toute divergence trouvée nécessite un amendement à ADR-039 ou ce document **avant** migration.

**Avant C4** : B-02 (rights), B-03 (Invoice obligatoire et settlement), B-04 (Pricing/FX), B-05 (POS policy) et schémas internes figés ; tests PG concurrents et multi-tenant prévus. Pas de POS « fonctionnel » sur simples mocks.

**Avant C5** : B-04 fiscalité, B-07 stockage, séparation receipt/tax invoice et workflow de réimpression fixés ; conformité juridique extérieure indépendante du verdict technique.

**Avant C6 / Phase 10B** : B-01/B-02/B-05/B-06, AI Gateway contracts et politiques de classification/consentement ; AI offline n'empêche pas Core.

**Avant Phase 11** : migration/backfill `productCode`, compatibilité `resolveEffective`, Pricing/Billing par produit, stratégie bundle, test de suspension d'un produit sans toucher à l'autre.

**Avant Phase 11.5** : versionnement des outils, classe A3 avec permissions/approbation expirante et effet réellement auditables ; budgets tenant/produit, arrêt d'urgence.

**Avant Phase 12 / release** : tests A/B, E1/E2, BUYER C1/C2, staff, POS multi-caissier, doubles retries, remboursements, offline indéterminé, PSP signé, restore, charge, anciens SDK, stockage réel et critères pays. RPO ≤15 minutes et RTO ≤4 heures sont des objectifs d'ingénierie, pas des garanties actuelles. Les gates juridiques externes restent `BLOCKED_EXTERNAL` sans être renommés `PASS`.

## B-09 — Matrice minimale de preuve avant fermeture

| Axe | Tests et preuve nécessaires |
|---|---|
| Compatibilité | anciennes APIs/entitlements/souscriptions/Sales/Purchases/Cash/10A identiques sur fixtures migrées, OpenAPI diff, ancien SDK |
| Produit | MC-only, ZAMUREK-only, double souscription, suspension produit isolée, suspension org globale, downgrade/override sans escalade |
| Acteurs | buyer≠staff, POS walk-in, staff E1 interdit E2, venue opt-out, AGENT refus A3 sans approbation, 404 non-existence croisée |
| Financier | une vente = un order+invoice+payment+cash si espèces, remboursements append-only, rendu net, stock, 20–100 retries concurrents synthétiques |
| Pricing | conversion pondérale et FX Decimal, taux modifié sans réécriture, taxes/arrondis, quote expirée et source extérieure non fiable |
| Ops | migration depuis 9.6 et 10A, rollback/forward-fix, stockage réel, impression défaillante, DB/AI outage, restore, charge et p95/p99 |
| Sécurité | BOLA/IDOR, protections JWT/OIDC, secrets, supply-chain, consentement, redaction, audit/Outbox, kill-switch |
| Provenance | PR + commit SHA + CI PR et post-merge + environnement + jeu de données + métriques ; `NOT_RUN` ≠ `PASS` |

**Règle de préséance :** le présent document précise les arbitrages techniques insuffisamment définis dans Docs/104–113 et ne remplace pas les exigences non contradictoires. Si un conflit persiste, arrêt des migrations concernées et ADR explicite avant implémentation.

## Registre des décisions D-01 à D-10 — 27/10/2026

| Décision | État | Portée et gate restant |
|---|---|---|
| D-01 Visibilité et propriété intellectuelle | DECIDED / ACCEPTED | Dépôt public intentionnel, Core propriétaire. Pas de licence OSS nouvelle; notice existante reste soumise à revue juridique; secrets/scans/protections maintenus. |
| D-02 Multi-produits et abonnements | DECIDED / ACCEPTED | Registre stable serveur, codes `MONARQUE_CONNECT` et `ZAMUREK`; un abonnement effectif max par org/produit, exclusion de périodes par produit; resolver legacy Connect et nouveau resolver explicite. Tarif ZAMUREK 7 USD hypothèse inactive. Contrat C1: Docs/116. |
| D-03 Monarque Auth / identité | DECIDED / ACCEPTED | Mapping durable `(issuer, subject) → internalUserId`, association explicite, pas de rapprochement email, sessions legacy coexistantes. Implémentation C2 uniquement. |
| D-04 POS et finance | DECIDED / ACCEPTED | `ConfirmPosSale` possède une transaction SQL, écritures canoniques/Outbox, PSP et impression hors transaction, compensations append-only. Implémentation C4 uniquement. |
| D-05 Documents/fiscalité | DECIDED / ACCEPTED | Facture interne, reçu et document fiscal séparés; conformité RDC non présumée. Validation externe bloque le flux concerné. |
| D-06 Prix, unités et FX | DECIDED / ACCEPTED | Tarification versionnée côté serveur, Decimal/entiers, snapshots immuables, FX derrière port et fail-closed sans taux valable. Sélection commerciale du fournisseur reste ouverte. |
| D-07 Stockage documentaire | DECIDED / ACCEPTED | Abstraction S3-compatible chiffrée, tenant-scoped, checksum/version/révocation/audit/restore. Prestataire et résidence à approuver avant production; C5. |
| D-08 Résilience | DECIDED / ACCEPTED comme objectifs | RPO cible ≤15 min, RTO cible ≤4 h; objectifs non démontrés. Restore/perf p95/p99 et charge sont des preuves C8/release, pas un blocage du cadrage C0. |
| D-09 Contrats et calendrier ZAMUREK | DECIDED / ACCEPTED | Contrat OpenAPI minimal/allowlist/version/SHA; cadrage → SDK/tests après contrat stable → intégration après commandes livrées → commercialisation après tous les gates. PR ZAMUREK #2 reste draft jusqu'au gel des frontières. |
| D-10 IA/agents | DECIDED / ACCEPTED | Interfaces versionnées, aucun accès Prisma/admin, droits tenant/produit/action, approbation humaine et audit pour actions sensibles. Runtime non inclus en C1. |

Les statuts `DECIDED / ACCEPTED` qualifient l'architecture, pas la livraison des fonctionnalités ni la preuve de conformité externe. Les gates C1 à C8 et commerciaux restent suivis séparément.
