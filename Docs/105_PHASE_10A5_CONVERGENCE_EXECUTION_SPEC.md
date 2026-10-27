# Phase 10A.5 — Convergence Monarque Connect × ZAMUREK

**Statut au 27/10/2026 : CADRAGE EN COURS / C0 NOT_ACCEPTED / C1–C8 NON IMPLÉMENTÉS.** Entre **10A clôturée** et **10B**. La présente phase ne se substitue ni aux gates externes FairScale 9.6 ni à 11/11.5/12.

## Objectif / résultat
Obtenir **un seul Core transactionnel** intégrable par ZAMUREK, sans rupture des modules déjà livrés, avec APIs/contracts/policies partagés, mécanisme POS et pricing intégrables. Monarque Connect est le dépôt propriétaire du Core ; au 27/10/2026, la visibilité GitHub observée est `PUBLIC` et ne constitue pas une garantie de confidentialité. Pendant les phases techniques Monarque Connect 10A.5, 10B, 11, 11.5 et 12, le dépôt `jupi-z/ZAMUREK` reste limité au cadrage documentaire et à la revue de contrats inter-dépôts. Le code des clients, SDK, intégrations runtime et verticales ZAMUREK ne commence qu'après clôture technique de ces phases et CI post-fusion verte pour chacune; les gates externes commerciaux ou juridiques restent distincts.

**Frontières gelées avant toute migration :** [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), B-00→B-09. [L'audit C0 de la baseline](115_PHASE_10A5_C0_CODEBASE_AUDIT.md) documente le code réel au `main@0df3c09`; audit réalisé, mais gate C0 `NOT_ACCEPTED`. La synchronisation de la PR #152 a été faite sans conflit avec le main observé. La CI de baseline est verte, mais les checks du nouveau head restent requis. Les écarts sont principalement des extensions futures absentes (product scope, OIDC, POS atomique, FX) ; les décisions P0 et preuves opérationnelles sont répertoriées dans Docs/115. L'ajout d'un produit ne change ni les API historiques Monarque Connect, ni son `defaultCurrency`, ni ses souscriptions existantes.

## Tranches ordonnées et dépendances
| Tranche | Livrable obligatoire | Pré-requis / tests |
|---|---|---|
| C0 Audit contractuel | Cartographie réelle des domaines, modèles, contraintes, services transactionnels, compatibilité, produit/identité/POS/FX, décisions ouvertes et stratégie migration/rollback ([audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md)) | Audit de baseline documenté. C0 ne sera accepté qu'après revue du head synchronisé et CI PR, arbitrages D-01→D-03 et acceptation formelle des contrats/backfill. Issue #153 ouverte. |
| C1 Shared Product/Entitlements | `productCode=MONARQUE_CONNECT|ZAMUREK`, offres/souscriptions et entitlements résolus par produit ; maintien explicite du resolver legacy Monarque Connect, isolement suspensions produit ; périmètre client vs staff | Test ZAMUREK BASIC ne donne jamais CRM/PURCHASES/Enterprise ; anciens plans intacts |
| C2 Shared identity/tenancy & channel | Channel résolu côté serveur, buyers externes identifiés sans Membership commercial obligatoire, lien IdP futur via issuer+sub sans migration forcée, walk-in POS lié à staff ; `organizationId, establishmentId, objectOwner` | Tests BOLA/IDOR, une org deux établissements, venue opt-in tiers |
| C3 Shared pricing/catalog contracts | Révisions `Item`/offerings, unités pondérales, variants/options déléguées ; `PricingContext`, devis CDF/version/taxe/montants immuables ; préserver defaultCurrency existant | Property tests Decimal 125 g / USD→CDF, ancienne commande inchangée |
| C4 Sales/POS orchestration seam | `ConfirmPosSale` est l'unique commande publique de finalisation POS locale ; `CapturePosTender` est interne. Parcours PSP distinct : intention durable puis finalisation transactionnelle après webhook vérifié. Orchestration prix→commande→Invoice canonique→PaymentRecord→CashMovement net si espèces→Outbox dans une transaction Core unique ; garder `PaymentRecord.invoiceId` obligatoire ; session, terminal, stock, permissions POS granulaires, idempotence | Répétition/replay/concurrence non doublés ; calcul rendu monnaie et cash reconciliation ; aucune transaction SQL ouverte sur appel réseau PSP |
| C5 Fiscal documents boundary | `CommercialDocumentRenderer`, documents imprimables A4 et 58/80 mm sur stockage persistant réel, impression après commit via clients Kotlin/Rust ; séparation Invoice interne / RECEIPT / TAX_INVOICE et contrôles fiscalité par pays / légalité, sans faux QR DGI | Historique/version/numéro stable, facture non « fiscalisée » à tort |
| C6 AI/Events shared ports | Reprendre Event Fabric 10A, contrats `ToolDefinition/ModelGateway/PolicyDecision/Approval` compatibles ZAMUREK ; aucun second runtime | Tests tool action refusée sans tenant/approval, AI disabled n'affecte commerce |
| C7 Public/merchant API façade | Contrats REST/OpenAPI versionnés, API public catalogue/menu/slot scope limité, API staff POS, tests e2e avec doubles clients et entitlements | Aucun accès factures/clients d'un merchant voisin ni données personnelles venue |
| C8 Release/proof | Migration empty DB + upgrade 10A / 9.6, tests unit/e2e/perf ciblés, documentation et modèle de preuves, DI/compatibilité | CI PR et `main` vertes, aucune régression phases 1–10A, rapport traçable |

**C4 et C5** peuvent être livrés dans une sous-phase de hardening POS *à la suite* de C0–C3, mais la **clôture finale de 10A.5** exige tous les critères C0–C8. Le développement des **clients/verticales ZAMUREK** est reporté jusqu'à la clôture technique de Monarque Connect 10A.5, 10B, 11, 11.5 et 12, avec CI post-fusion verte sur chaque phase. Le gel des contrats C0–C3/C6/C7 est un prérequis d'intégration, pas une autorisation anticipée; aucune vente ZAMUREK ne peut être considérée prête avant les preuves C4–C5 et les gates applicables.

## Principes d'intégration

Les chemins critiques C1–C5 doivent satisfaire les invariants B-01→B-07 de Docs/114, et non simplement déclarer les endpoints opérationnels. Paiement PSP externe, imprimante et fournisseur IA **ne participent pas** à la transaction SQL ; finalisation PSP uniquement après preuve signée. Tester anciens clients et ensembles de données migrés.

- Pas de second service `PrismaService` commercial ZAMUREK ni seconde copie des tables monétaires ; une transaction Core atomique. Pas de `POST /order` qui déclenche ensuite deux intégrations asynchrones non compensées.
- Aucun changement global brutal `defaultCurrency` → USD : prix source USD **uniquement** sur canaux/offres ZAMUREK avec policy; Sales anciennes continuent.
- Aucune obligation de compte client en POS physique ; seller/cashier permissions et garde-fou d'unicité des transactions.
- Un achat mall reste **mono-vendeur**, venue voit listings consentis et non mouvements de trésorerie.
- Règles fiscales RDC et catalogue pharmaceutique non licencié = blocage des transactions concernées.
- Réutiliser les contrats OpenAPI / événements déjà existants après cartographie explicite, pas un remplacement unilatéral.

## Décisions opérationnelles restant à obtenir
Règles fiscales officielles RDC, méthode fournisseur/terminal de fiscalisation, périmètre réel abonnement ZAMUREK BASIC (quotas, établissements, coût), architecture de paiement cash et transferts, rôles éditeurs, hébergement/SMTP/LLM et confidentialité du code propriétaire. Cela ne bloque **pas** C0–C3 ni tests synthétiques. Ne jamais simuler des accords LaJoie Mall.

## Rapports par tranche
Pour chaque C0–C8 : état PLANNED/IN_PROGRESS/IMPLEMENTED/TESTED/ACCEPTED/BLOCKED, tests exacts/CI/commit, migration et risques ; progrès global seulement pondéré avec preuves. `Docs/108_PHASE_10A5_PROGRESS_PLAN.md` décrit la grille. Ne pas clore 10A.5 sans CI et intégrations pertinentes.

## Outillage recommandé
NestJS/Prisma/PostgreSQL existants ; contrats JSON Schema/OpenAPI et modules avec frontières strictes ; petites migrations additives. Éviter nouvelle plateforme, ORM ou architecture microservices. Le repo ZAMUREK n'héberge pas de secrets, données réelles ou copie du Core.
