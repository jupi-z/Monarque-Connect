# Matrice de recette 10A.5 — critères de fermeture

**État initial : NOT_RUN pour tous les critères, aucun code implémenté par ce cadrage.**

| Gate | Priorité | Preuve exigée |
|---|---|---|
| G-01 CI base préservée | P0 | CI main/pr vérifiée sans régression phases 1→10A, migrations base vide + upgrade |
| G-02 Shared boundaries | P0 | ADR-039 + contrat product/entity owners, plus aucun schéma concurrent pour Sales/Cash/Invoice |
| G-03 Cross-product isolation | P0 | BOLA org A/B, establishments E1/E2, acheteur C1/C2, tenant ayant 2 produits |
| G-04 Entitlements | P0 | BASIC ZAMUREK n'ouvre pas CRM/PURCHASES/Enterprise, FairScale original inchangé |
| G-05 Orders/claims | P0 | Sale POS/online partage SalesOrder canonique, walk-in sans compte public, double retry retourne même résultat |
| G-06 Cash atomicity | P0 | Un cash tender = PaymentRecord + CashMovement cohérents, zéro doublon, rendu monnaie exact, clôture caisse |
| G-07 Documents | P0 | A4/thermique local depuis document versionné ; fiscalisation fausse impossible ; dossier légal RDC |
| G-08 FX | P0 | 125g à 20 USD/kg × 2360 = 5900 CDF, decimal exact ; taux changé ne modifie pas ordre émis |
| G-09 Event Fabric & AI | P0 | EventEnvelope commun, agent cross-tenant refusé, action financière exige confirmation et audit |
| G-10 Venue/vertical adapter | P1 | Deux marchands opt-in; listing public seulement; séparation réelle des commandes et fonds |
| G-11 API compatibility | P0 | contrats OpenAPI versionnés, anciens endpoints Sales/Billing inchangés ou migrations explicites |
| G-12 Resilience | P0 | service LLM indisponible : ventes/caisse marchent ; restore synthétique testée |
| G-13 Documentation | P1 | plan ZAMUREK aligné, rapport phase+% prouvés, tickets tracés, issue follow-up |
| G-14 Security & supply chain | P0 | RBAC, données personnelles, SBOM/licences, JWT, no secrets et CI scans passés |

**Deux seuils distincts :**
1. **Démarrage du développement client ZAMUREK** : ADR-039, C0–C3 et C6/C7 **contrats gelés et testables** (les APIs POS métier peuvent encore être mocks côté UI sans prétendre à la validation transactionnelle), G-01 à G-04, G-11, G-13 au minimum.
2. **Clôture de 10A.5** : G-01 à G-14 PASS avec preuves effectives (hormis légal commercial externe qui reste BLOQUÉ pour production sans empêcher code terminé). Toutes écritures financières nécessitent G-05/06/07. Les gates externes 9.6 restent ouverts tant que les opérations réelles non prouvées.

Le statut des phases closes reste clos. Pas de « 100% » sans logs/test/commit et environnement enregistrés ; un dossier écrit seul n'est pas un gate PASS.
