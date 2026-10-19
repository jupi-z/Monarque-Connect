# 92 — FairScale V1 : matrice d'acceptation et preuves attendues

**Statut initial : non testé / non implémenté.** Chaque ligne doit acquérir test, commit, CI PR, CI post-fusion et preuve de migration si applicable ; ne pas cocher sans exécution GitHub.

| ID | Scénario d'acceptation | Phase |
|---|---|---|
| FS-001 | CONNECT gratuit créé par défaut ; 1 établissement, 5 membres max | 9.5 |
| FS-002 | OPERATIONS 1500/1275/14400 cents selon mensuel normal/welcome/annuel | 9.5 |
| FS-003 | BUSINESS 4500/3825/43200 cents | 9.5 |
| FS-004 | ENTERPRISE 18000/15300/172800 cents | 9.5 |
| FS-005 | Annual -20 % récurrent, aucune application aux add-ons | 9.5 + 9.6 |
| FS-006 | Welcome -15 % limité à 3 mensualités d'une entreprise ; no reset résiliation, multiorg ou upgrade | 9.5 + 9.6 |
| FS-007 | Mensuel welcome puis annuel : annual -20 % permis, pas de cumul et pas de réactivation welcome | 9.6 |
| FS-008 | 200 membres BUSINESS sans supplément ni quota commercial bloquant, RBAC inchangé | 9.5 |
| FS-009 | CONNECT garde garde-fou de cinq membres | 9.5 |
| FS-010 | Base établissements 1/1/3/10, add-on 1000/12000 cents, capacité active atomique | 9.5 |
| FS-011 | Warehouse ne compte pas comme établissement supplémentaire | 9.5 |
| FS-012 | Add-on non payé ne confère aucun droit ; activation explicite et consentie | 9.5 + 9.6 |
| FS-013 | Sur downgrade avec trop d'établissements : aucun effacement, message correct et mesure planifiée | 9.6 |
| FS-014 | Type d'entreprise, effectif et chiffre d'affaires ne forcent pas le forfait | 9.5 |
| FS-015 | Module hors plan interdit en backend même si route invoquée directement | 9.5 |
| FS-016 | Plans antérieurs EUR et données historiques conservés ; nouvelles versions USD immuables | 9.5 |
| FS-017 | Même quote/priceVersion = même total, cent précis et aucun float | 9.5 |
| FS-018 | Prix expiré/version révoquée ne déclenche ni droit ni facture non autorisée | 9.6 |
| FS-019 | Uniques légaux : société distincte ≠ même identité de facturation ; doublons examinables | 9.5 |
| FS-020 | Paiement confirmé par provider signé avant abonnement payant ACTIVE | 9.6 |
| FS-021 | Webhook replays/out-of-order/concurrent ne créent ni double facture ni double promotion | 9.6 |
| FS-022 | Paiement non confirmé / fausse redirection => aucun entitlement payant | 9.6 |
| FS-023 | Upgrade devis/consentement/prorata sur payé réel ; downgrade échéance future | 9.6 |
| FS-024 | Renouvellements fin de mois/bissextile et UTC déterministes | 9.6 |
| FS-025 | PAST_DUE à J+7 restreint payant ; compte/factures/export préservés | 9.6 |
| FS-026 | Paiement tardif et reprise droits audités sans seconde période active | 9.6 |
| FS-027 | Entités Billing séparées des factures tenant SALES / PaymentRecord | 9.6 |
| FS-028 | Isolation A/B sur quotes/invoices/payment/provider lookup ; aucun PII en logs/events | 9.6 |
| FS-029 | Actions PLATFORM_ADMIN auditées ; tenant OWNER non autorisé à accéder à plateforme | 9.6 |
| FS-030 | Compatibilité auth/tenancy/Sales/Purchases/Inventory/Messaging Phases 0–9, HTTP E2E | 9.5 + 9.6 |
| FS-031 | PostgreSQL upgrade ancien→nouveau, base vide, seed idempotent, migration rollback/forward-fix | 9.5 + 9.6 |
| FS-032 | CI GitHub PR puis post-fusion main toutes vertes et preuves versionnées | 9.5 + 9.6 |
| FS-033 | Le lancement live échoue fermé si provider non vérifié (ou circuit manuel contrôlé non prouvé) | 9.6 |
| FS-034 | Suppression/annulation n'efface pas les données business ; export conforme Docs/41 | 9.6 |
| FS-035 | ENTERPRISE ne promet pas SLA/infra dédiée/conformité non réellement livrés | 9.6 |

## Jeux de tests chiffrés obligatoires

- BUSINESS 3 premiers mois mensuels : 38,25 USD chacun ; 4e : 45,00 USD ; 12 premiers mois complets = 519,75 USD ; les 9 suivants = 405 USD, les 3 premiers = 114,75 USD.
- BUSINESS annuel : 432,00 USD à l'inscription, puis 432,00 USD à chaque renouvellement si prix de référence inchangé ; pas 540 USD automatiquement.
- OPERATIONS annuel = 144,00 USD ; ENTERPRISE annuel = 1 728,00 USD.
- BUSINESS 5 établissements actifs : base 3 + 2 add-ons ; mois régulier = 45 + 20 = 65 USD ; annuel = 432 + 240 = 672 USD.
- Les remises annuelles sont appliquées **seulement sur le forfait de base**. Une invoice add-on ne doit pas devenir négative.
- Aucune double comptabilisation quand le webhook provider est envoyé 10 fois.
- Un client connecté comme tenant A ne lit aucune ligne Billing appartenant à tenant B, y compris par UUID valide B.

## Preuves et clôture
Pour chaque PR, établir SHA et CI GitHub hosted ; mesurer nombre de tests, migrations, contrat OpenAPI et toute exception. Un status à cocher sous Docs/93 ne remplace jamais une preuve de test. Phase 9.5 exige une clôture autonome ; Phase 9.6 exige un scénario de souscription complet en environnement sandbox avec provider vérifié, ou un circuit manuel rapproché et justifié ; les promesses de disponibilité/impôts restent hors gates non validés.

La Phase 12 conserve les tests release complets, performance, sauvegardes et audit final.
