# Matrice de recette 10A.5 — critères de fermeture

**État initial : NOT_RUN pour tous les critères, aucun code implémenté par ce cadrage.** Les invariants [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md) sont des critères **P0** supplémentaires avant migration ; une mise à jour documentaire n'est pas une preuve technique.

| Gate | Priorité | Preuve exigée |
|---|---|---|
| G-01 CI base préservée | P0 | CI main/pr vérifiée sans régression phases 1→10A, migrations base vide + upgrade |
| G-02 Shared boundaries | P0 | ADR-039 + contrat product/entity owners, plus aucun schéma concurrent pour Sales/Cash/Invoice |
| G-03 Cross-product isolation | P0 | BOLA org A/B, establishments E1/E2, acheteur C1/C2, tenant ayant 2 produits |
| G-04 Entitlements | P0 | subscription par produit, resolver legacy MC préservé, suspension ZAMUREK sans suspendre MC, BASIC n'ouvre pas CRM/PURCHASES/Enterprise |
| G-05 Orders/claims | P0 | Sale POS/online partage SalesOrder + Invoice canoniques, PaymentRecord.invoiceId obligatoire, walk-in sans compte public, double retry retourne même résultat |
| G-06 Cash atomicity | P0 | un tender validé = Invoice + PaymentRecord + CashMovement net si espèces, stock/sessions/RBAC, zéro doublon, rendu monnaie exact, clôture caisse |
| G-07T Documents techniques | P0 | Rendu A4/thermique à partir d'un document versionné, stockage durable réel, checksum/récupération, séparation `RECEIPT` / `TAX_INVOICE`, aucune fausse déclaration de fiscalisation ; tests techniques prouvés |
| G-07E Fiscalité et autorisations externes | EXTERNAL | Règles fiscales RDC confirmées, homologation/autorisation du circuit concerné et dossier légal vérifié par les responsables compétents ; bloque `COMMERCIAL_GO`, mais ne transforme pas les tests techniques en `NOT_RUN` |
| G-08 FX | P0 | 125g à 20 USD/kg × 2360 = 5900 CDF, decimal exact ; taux changé ne modifie pas ordre émis |
| G-09 Event Fabric & AI | P0 | EventEnvelope commun, agent cross-tenant refusé, action financière exige confirmation et audit |
| G-10 Venue/vertical adapter | P1 | Deux marchands opt-in; listing public seulement; séparation réelle des commandes et fonds |
| G-11 API compatibility | P0 | contrats OpenAPI versionnés, anciens endpoints Sales/Billing inchangés ou migrations explicites |
| G-12 Resilience | P0 | service LLM indisponible : ventes/caisse marchent ; restore synthétique testée |
| G-13 Documentation | P1 | plan ZAMUREK aligné, rapport phase+% prouvés, tickets tracés, issue follow-up |
| G-14 Security & supply chain | P0 | staff/BUYER/AGENT distincts, POS permissions dédiées, RBAC, données personnelles, OIDC-ready, SBOM/licences, JWT, no secrets et CI scans passés |

**Deux seuils distincts :**
1. **Séquence ZAMUREK selon D-09** : cadrage et recherche UX avant contrats stables; fondations client/SDK et tests contractuels après stabilisation des contrats Core nécessaires; intégration fonctionnelle après livraison des opérations correspondantes; commercialisation après les gates techniques et externes applicables. Les 43 capacités V1 restent requises; cette séquence ne réduit pas le périmètre.
2. **Clôture de 10A.5** : G-01 à G-14 PASS avec preuves effectives (hormis légal commercial externe qui reste BLOQUÉ pour production sans empêcher code terminé). Toutes écritures financières nécessitent G-05/06/07. Les gates externes 9.6 restent ouverts tant que les opérations réelles non prouvées.

Le statut des phases closes reste clos. Pas de « 100% » sans logs/test/commit et environnement enregistrés ; un dossier écrit seul n'est pas un gate PASS.

## Statuts de fermeture distincts — complément normatif

- **TECH_PASS** : critères techniques G-01–G-14 réellement prouvés (commit, migrations, PostgreSQL, tests de sécurité/E2E et CI). `NOT_RUN` ou `BLOCKED` ne devient pas `PASS` par une simple documentation.
- **EXTERNAL_PENDING** : règles/homologation fiscales RDC, PSP réel, mandats, conformité ou validation matérielle non prouvés. Ces faits restent explicitement ouverts et interdisent le **COMMERCIAL_GO** du flux concerné, sans empêcher de reconnaître les critères techniques effectivement passés. Le dossier légal RDC et l'homologation sont suivis comme G-07E externe, pas comme réussite technique G-07T.
- **RELEASE_GO** : décisions distinctes Core, Monarque Connect et ZAMUREK, après prérequis techniques **et** externes applicables. Aucun critère légal n'est réputé rempli faute de preuve.

Avant G-05/06, prouver que `PaymentRecord.invoiceId` demeure non-null, que chaque vente POS réussie a une Invoice canonique, et que les anciens KPI 10A demeurent exacts (Docs/114 B-03). Toute alternative nécessite une nouvelle ADR avant migration. Le contrat public est `ConfirmPosSale` pour finaliser le POS local ; `CapturePosTender` n'est qu'un port interne. Les PSP utilisent une intention durable et une finalisation déclenchée par preuve webhook vérifiée, jamais une capture client.
