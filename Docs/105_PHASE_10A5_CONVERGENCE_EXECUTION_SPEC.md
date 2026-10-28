# Phase 10A.5 — Convergence Monarque Connect × ZAMUREK

**Statut vérifié au 28/10/2026 : C0, C1.1–C1.4 et C2.1–C2.4 clôturés avec preuves GitHub-hosted; C3.1 contract-first est clôturé.** C2 documentaire a été synchronisé par PR #170 sur `main@2dff07eae662d8de186d6f23cf831dd72c1dfec9`, CI post-fusion #40635438412 verte. Le contrat C3.1 a été fusionné par PR #172 dans `main@e19bd1fba2bb3757bb13ea8466383bd34fbb7846`; CI PR #569 et post-fusion #40639567210 vertes. **C3.2 est en cours sur une branche dédiée**; son implémentation et sa migration restent non validées tant que la PR et ses preuves GitHub Actions ne sont pas disponibles. C3.3–C3.4 ne sont pas commencées. C4–C8 restent planifiés et non autorisés. Cette convergence demeure entre **10A clôturée** et **10B** et ne se substitue ni aux gates externes FairScale 9.6 ni à 11/11.5/12.

## Objectif / résultat
Obtenir **un seul Core transactionnel** intégrable par ZAMUREK, sans rupture des modules déjà livrés. Monarque Connect est le dépôt propriétaire du Core ; visibilité GitHub `PUBLIC` intentionnelle, sans licence open source accordée. ZAMUREK progresse par étapes : cadrage avant contrats stables; SDK et tests contractuels après stabilisation des contrats Core nécessaires; intégration fonctionnelle après livraison des opérations transactionnelles concernées; commercialisation après les gates techniques et externes applicables. Aucun développement applicatif ZAMUREK n'est inclus dans C0/C1.

**Frontières gelées avant migration :** [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), B-00→B-09, décisions D-01→D-10 et contrat C1 dans [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md). [L'audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md) décrit l'état inspecté à la baseline `main@0df3c09`; son addendum consigne la clôture et la progression ultérieure. Les migrations C1.2 et C1.3 sont additives et prouvées par CI; C1.4 est validé par CI PR et post-fusion. Les capacités futures (OIDC, POS atomique, FX) ne sont pas déclarées implémentées. C1 préserve APIs, identifiants, devise et snapshots historiques Monarque Connect.

## Tranches ordonnées et dépendances
| Tranche | Livrable obligatoire | Pré-requis / tests |
|---|---|---|
| C0 Audit contractuel | Cartographie réelle des domaines, modèles, contraintes, services transactionnels, compatibilité, produit/identité/POS/FX, décisions et stratégie migration/rollback ([audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md)) | D-01→D-10 acceptées. Clôture après revue du head synchronisé, CI PR et CI post-fusion; issue #153 clôturée après preuve. |
| C1 Shared Product/Entitlements | `productCode=MONARQUE_CONNECT|ZAMUREK`, offres/souscriptions et entitlements résolus par produit ; maintien explicite du resolver legacy Monarque Connect, isolement suspensions produit ; périmètre client vs staff | Test ZAMUREK BASIC ne donne jamais CRM/PURCHASES/Enterprise ; anciens plans intacts |
| C2 Identity, tenant principals & fédération préparatoire | Registre additif `issuer+subject → User.id`; catégories STAFF/BUYER/AGENT/PLATFORM avec provenance vérifiable; STAFF résolu par membership serveur; buyer capability uniquement sur ressources possédées; walk-in exécuté par STAFF. C2 n'active pas de provider OIDC runtime. | Unicité/révocation/concurrence, aucune liaison par email, sessions legacy, falsification actor/tenant/product, BOLA/IDOR établissement/ressource; migration additive |
| C3 Shared pricing/catalog contracts | Contrat normatif [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md); conserver `Item`, offres et prix commerciaux distincts de FairScale; mesures dimensionnelles, variantes, pricing context et snapshots FX/taxes versionnés | Contrat gelé avant migration; test Decimal `125 g × 20 USD/kg × 2360 = 5900 CDF`; snapshots historiques inchangés |
| C4 Sales/POS orchestration seam | `ConfirmPosSale` est l'unique commande publique de finalisation POS locale ; `CapturePosTender` est interne. Parcours PSP distinct : intention durable puis finalisation transactionnelle après webhook vérifié. Orchestration prix→commande→Invoice canonique→PaymentRecord→CashMovement net si espèces→Outbox dans une transaction Core unique ; garder `PaymentRecord.invoiceId` obligatoire ; session, terminal, stock, permissions POS granulaires, idempotence | Répétition/replay/concurrence non doublés ; calcul rendu monnaie et cash reconciliation ; aucune transaction SQL ouverte sur appel réseau PSP |
| C5 Fiscal documents boundary | `CommercialDocumentRenderer`, documents imprimables A4 et 58/80 mm sur stockage persistant réel, impression après commit via clients Kotlin/Rust ; séparation Invoice interne / RECEIPT / TAX_INVOICE et contrôles fiscalité par pays / légalité, sans faux QR DGI | Historique/version/numéro stable, facture non « fiscalisée » à tort |
| C6 AI/Events shared ports | Reprendre Event Fabric 10A, contrats `ToolDefinition/ModelGateway/PolicyDecision/Approval` compatibles ZAMUREK ; aucun second runtime | Tests tool action refusée sans tenant/approval, AI disabled n'affecte commerce |
| C7 Public/merchant API façade | Contrats REST/OpenAPI versionnés, API public catalogue/menu/slot scope limité, API staff POS, tests e2e avec doubles clients et entitlements | Aucun accès factures/clients d'un merchant voisin ni données personnelles venue |
| C8 Release/proof | Migration empty DB + upgrade 10A / 9.6, tests unit/e2e/perf ciblés, documentation et modèle de preuves, DI/compatibilité | CI PR et `main` vertes, aucune régression phases 1–10A, rapport traçable |

**C4 et C5** peuvent être livrés après C0–C3; la **clôture finale de 10A.5** exige les critères techniques applicables C0–C8. Les clients/SDK ZAMUREK peuvent démarrer après stabilisation des contrats Core nécessaires; intégration fonctionnelle après livraison des opérations correspondantes; commercialisation après les gates applicables. Le périmètre final V1 ZAMUREK n'est pas réduit. C2 ne développe ni l'application ZAMUREK ni Monarque Auth.

### État d'exécution des lots au 28/10/2026

| Lot | État | Preuve / portée |
|---|---|---|
| C0 | DONE | Issue #153 close; audit et décisions consignés dans Docs/115 et Docs/114. |
| C1.1–C1.4 | DONE | PR #158–#162 fusionnées; preuves dans Docs/118. |
| C2.1–C2.4 | DONE | PR #164–#168 fusionnées; clôture documentaire PR #169; issue #163 close; baseline fonctionnelle `bef5d7fa92522f71466b9933917853ed96796dd7`, CI post-fusion #559 success; baseline documentaire actuelle `7e724fb7d07669d6c1e66342e0222f4bd81c77f9`, CI #561 success. |
| C3 | AUTHORIZED / C3.1 DONE / C3.2 IN PROGRESS | Contrat [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md) fusionné par PR #172; CI post-fusion #40639567210 verte. C3.2 est en travail, non testé ni livré; voir [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md). C3.3–C3.4 NOT STARTED. |
| C4–C8 | PLANNED / NOT AUTHORIZED | Hors périmètre de l'autorisation actuelle. |

## Principes d'intégration

Les chemins critiques C1–C5 doivent satisfaire les invariants B-01→B-07 de Docs/114, et non simplement déclarer les endpoints opérationnels. Paiement PSP externe, imprimante et fournisseur IA **ne participent pas** à la transaction SQL ; finalisation PSP uniquement après preuve signée. Tester anciens clients et ensembles de données migrés.

- Pas de second service `PrismaService` commercial ZAMUREK ni seconde copie des tables monétaires ; une transaction Core atomique. Pas de `POST /order` qui déclenche ensuite deux intégrations asynchrones non compensées.
- Aucun changement global brutal `defaultCurrency` → USD : prix source USD **uniquement** sur canaux/offres ZAMUREK avec policy; Sales anciennes continuent.
- Aucune obligation de compte client en POS physique ; seller/cashier permissions et garde-fou d'unicité des transactions.
- Un achat mall reste **mono-vendeur**, venue voit listings consentis et non mouvements de trésorerie.
- Règles fiscales RDC et catalogue pharmaceutique non licencié = blocage des transactions concernées.
- Réutiliser les contrats OpenAPI / événements déjà existants après cartographie explicite, pas un remplacement unilatéral.

## Validations externes restant ouvertes
Règles fiscales officielles RDC, méthode fournisseur/terminal de fiscalisation, prix/quotas/établissements/marge ZAMUREK, fournisseur PSP, résidence et hébergement de données, et accords commerciaux nommés restent à valider avant les usages concernés. Ces conditions ne bloquent pas le cadrage C0/C1 ni les tests synthétiques. La visibilité publique du dépôt est intentionnelle, mais ne donne aucun droit de réutilisation. Ne jamais simuler des accords LaJoie Mall.

## Rapports par tranche
Pour chaque C0–C8 : état PLANNED/IN_PROGRESS/IMPLEMENTED/TESTED/ACCEPTED/BLOCKED, tests exacts/CI/commit, migration et risques ; progrès global seulement pondéré avec preuves. `Docs/108_PHASE_10A5_PROGRESS_PLAN.md` décrit la grille. Ne pas clore 10A.5 sans CI et intégrations pertinentes.

## Outillage recommandé
NestJS/Prisma/PostgreSQL existants ; contrats JSON Schema/OpenAPI et modules avec frontières strictes ; petites migrations additives. Éviter nouvelle plateforme, ORM ou architecture microservices. Le repo ZAMUREK n'héberge pas de secrets, données réelles ou copie du Core.
