# Phase 10A.5 — Convergence Monarque Connect × ZAMUREK

**Statut au 22/10/2026 : PLANIFICATION / NON IMPLÉMENTÉ.** Entre **10A clôturée** et **10B**. La présente phase ne se substitue ni aux gates externes FairScale 9.6 ni à 11/11.5/12.

## Objectif / résultat
Obtenir **un seul Core transactionnel** intégrable par ZAMUREK, sans rupture des modules en production potentielle, avec APIs/contracts/policies partagés, mécanisme POS et pricing intégrables. La phase s'exécute dans le dépôt **privé** `jupi-z/Monarque-Connect`. Les clients et spécifications verticales restent dans `jupi-z/ZAMUREK` (**public** jusqu'à changement autorisé).

## Tranches ordonnées et dépendances
| Tranche | Livrable obligatoire | Pré-requis / tests |
|---|---|---|
| C0 Audit contractuel | Cartographie `Item/SalesOrder/Invoice/PaymentRecord/CashMovement/User/Organization/Subscription` et appels directs Prisma à interdire aux extensions ; plan de migrations / rollback | Sauvegarde snapshot synthétique, baseline CI verte, ADR-039 |
| C1 Shared Product/Entitlements | `productCode=MONARQUE_CONNECT|ZAMUREK`, offres/souscriptions et entitlements résolus par produit ; périmètre client vs staff | Test ZAMUREK BASIC ne donne jamais CRM/PURCHASES/Enterprise ; anciens plans intacts |
| C2 Shared identity/tenancy & channel | Channel résolu côté serveur, buyers externes identifiés sans Membership commercial obligatoire, walk-in POS lié à staff ; `organizationId, establishmentId, objectOwner` | Tests BOLA/IDOR, une org deux établissements, venue opt-in tiers |
| C3 Shared pricing/catalog contracts | Révisions `Item`/offerings, unités pondérales, variants/options déléguées ; `PricingContext`, devis CDF/version/taxe/montants immuables ; préserver defaultCurrency existant | Property tests Decimal 125 g / USD→CDF, ancienne commande inchangée |
| C4 Sales/POS orchestration seam | Application services / commands pour vente directe `origin=POS`, client de passage, lifecycle prix→commande→paiement→mouvement caisse→outbox transaction unique ; formaliser `CashSession, PosTerminal, SaleTender` | Répétition/replay/concurrence non doublés ; calcul rendu monnaie et cash reconciliation |
| C5 Fiscal documents boundary | `CommercialDocumentRenderer`, documents imprimables A4 et 58/80 mm, impression via clients Kotlin/Rust ; contrôles fiscalité par pays / légalité, sans faux QR DGI | Historique/version/numéro stable, facture non « fiscalisée » à tort |
| C6 AI/Events shared ports | Reprendre Event Fabric 10A, contrats `ToolDefinition/ModelGateway/PolicyDecision/Approval` compatibles ZAMUREK ; aucun second runtime | Tests tool action refusée sans tenant/approval, AI disabled n'affecte commerce |
| C7 Public/merchant API façade | Contrats REST/OpenAPI versionnés, API public catalogue/menu/slot scope limité, API staff POS, tests e2e avec doubles clients et entitlements | Aucun accès factures/clients d'un merchant voisin ni données personnelles venue |
| C8 Release/proof | Migration empty DB + upgrade 10A / 9.6, tests unit/e2e/perf ciblés, documentation et modèle de preuves, DI/compatibilité | CI PR et `main` vertes, aucune régression phases 1–10A, rapport traçable |

**C4 et C5** peuvent être livrés dans une sous-phase de hardening POS *à la suite* de C0–C3, mais la **clôture finale de 10A.5** exige tous les critères C0–C8. ZAMUREK peut commencer ses **clients/verticales** après gel de C0–C3/C6/C7 et contrat en place, sans attendre tous les tickets de caisse, mais ne peut pas déclarer ses flux financiers terminés avant C4–C5.

## Principes d'intégration
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
