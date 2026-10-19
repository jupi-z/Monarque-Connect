# 91 — Phase 9.6 : FairScale billing, paiements et mise en service commerciale

**STATUT : tranches 9.6.1 à 9.6.5 livrées et vérifiées ; tranche 9.6.6 de clôture reste ouverte pour les gates commerciales live et conformité.**
**Norme : Docs/89 ; plan : Docs/90 ; acceptance : Docs/92.**  
Cette phase précède la Phase 10 et réalise la couche commerciale de la plateforme ; elle ne clôt **pas** la Phase 11 Control Plane globale.

## Objectif de livraison
Un tenant s'inscrit sur CONNECT, achète un plan payant, paie, est activé selon droits, renouvelle au montant correct, obtient une facture de Monarque Group, peut changer de plan, ajouter/supprimer des capacités et résilier, y compris en cas de défaillance/rejeu fournisseur — le tout via API et sans frontend obligatoire.

## Tranches PR ordonnées

### 9.6.1 — États contractuels et invariants Billing
- Finaliser modèles additifs : SubscriptionBillingTerm, quote acceptée/checkout order, BillingInvoice et lignes immuables, BillingPaymentAttempt, BillingPayment, BillingRefund, ProviderEventInbox, PromotionRedemption, SubscriptionAddon, scheduled change, états d'incident et lien au Subscription effective.
- Verrou DB/idempotence : une facture par échéance/contrat, numéro indépendant de SALES, une consommation promotionnelle au plus par échéance, trois échéances welcome maximum par BillingCustomer, un event provider traité une fois, jamais deux subscriptions effectives qui se chevauchent.
- Totaux en cents USD, snapshots du prix (catalogVersion, discountCode, base/add-on, taxe explicitement résolue, currency). Aucun float financier.
- Articuler un *single writer* transactionnel de transition de souscription côté plateforme. Outbox atomique et workers idempotents ; pas de split brain entre billing state et entitlements.

### 9.6.2 — API commerciale complète
- Routes tenant OWNER/ADMIN : obtenir devis, accepter devis, demander paiement, consulter abonnements/factures/transactions (scopés), régler renouvellement, changer plan/cycle, add-ons, résilier ; scopes et erreurs RFC9457 cohérents.
- Créer checkout puis attendre webhook/preuve vérifiée avant activation ; réponse frontend/redirect seule ne modifie pas subscription.
- Prorata d'upgrade sur montant réellement payé restant ; les termes recalculés gardent dates et trace d'origine. Downgrade à l'échéance sauf exception consentie ; annulation stoppe le renouvellement sans suppression de données.
- Expiration des quotes et possibilité de rebâtir quote sur nouveau tarif : aucune facture autonome depuis un prix périmé.

### 9.6.3 — Paiement adaptateur et rapprochement
- Définir `PaymentProviderPort` neutre (create payment intent/checkout, verify signed webhook, reconcile status, refund request si supporté) et implémenter au moins un chemin réel démontrable ou canal manuel fortement contrôlé, en séparant sandbox et production.
- Vérifier secret/signature ou preuve provider, amount/currency/order, référence externe unique, échéance et tenant ; rejouer webhook idempotemment ; preuve out-of-order et concurrente.
- Aucun stockage de PAN/CVV, pas de montant de confiance provenant du client ; jamais confondre `PaymentRecord` (encaissement métier tenant) et paiement d'abonnement plateforme.
- Un adaptateur simulé n'est pas disponible en staging/production. Si aucun fournisseur live n'est validé, mettre un **gate bloquant le lancement commercial automatique** dans Docs/93/CI.

### 9.6.4 — Promotions, renouvellement, incidents
- Welcome -15 % sur trois premières factures mensuelles admissibles encaissées, une fois par entreprise; verrouiller la promotion au moment de la confirmation et assurer gestion cohérente des éventuels remboursements.
- Annual -20 % pour première échéance ET tous les renouvellements annuels ; pas de stacking ; extensions non remisées.
- Scheduler renouvellement robuste (idempotency key period + tenant, retries) ; priorité au mandat de paiement valide et aux notifications. Tester dates 28/29/30/31, année bissextile, UTC, 29 février.
- Dunning V1 sept jours ; PAST_DUE ne donne pas indéfiniment tous les droits ; restrictions après délai sans purge ; droit constant d'export/comptes/factures. Paiements tardifs, échecs définitifs, remboursement et chargeback déclenchent réévaluation auditée.
- Contrôler cas annuel→mensuel, mensuel→annuel, upgrade/downgrade, réduction d'extensions sur période, conflit multiorg et double facture.

### 9.6.5 — Administration Billing minimale (frontière Phase 11)
- Commandes `/api/v1/platform/billing/*` protégées par PLATFORM_ADMIN : lister contrats et invoices métadonnées, contrôler erreurs de rapprochement, publier prix versionnés, concessions explicitement motivées, exemptions temporaires bornées, journal d'audit.
- PLATFORM_SUPPORT lit des métadonnées strictement nécessaires, pas les cartes, secrets ni documents privés métiers. Pas d'impersonation générale.
- Toute modification de prix est versionnée : nouveau prix ≠ nouvelle facture rétroactive. Rendre l'état des entitlements observable, jamais laisser le support manipuler la DB directement.
- Phase 11 conserve la registry plateforme, les autres états tenant, support transversal, monitoring et opérations Control Plane non livrées par ce périmètre Billing.

### 9.6.6 — Vérification de la chaîne commerciale et clôture
- Test canonique HTTP « CONNECT → quote BUSINESS mensuel → welcome 38,25 USD → paiement vérifié → permissions BUSINESS → mois 4 à 45 USD → renouvellement annuel 432 USD → add-on 10 USD/mois ou 120 USD/an → downgrade programmé → export après annulation ».
- Tests ENTERPRISE 153 USD welcome / 1728 USD annuel récurrent, OPERATIONS 12,75 / 144, pas de tarifs persistés en EUR nouvelle V1. Rejouer webhooks, renouvellements, événements Outbox, litiges, paiement cross-tenant et refus d'out-of-plan.
- Migrations base neuve et upgrade depuis 9.5 (mais aussi depuis baseline Phase 9 en chaîne), stress test concurrence et non-régression 1–9.
- Exiger CI PR + post-fusion vertes, journal des décisions, Docs/93 mis à jour, preuves de clôture, documentation OpenAPI ; n'annoncer production possible qu'après revue conformité de factures de Monarque Group, provider opérationnel, observabilité, sauvegarde et rapprochement réellement prouvés.

## Conditions de rejet
Échec à toute gate Docs/92, défaut de signature fournisseur, double encaissement, prix client comme autorité, suppression de données sur résiliation, nouveau forfait imposé par effectif/secteur, accès plateforme aux données métier sans droit, migration destructrice non testée, publicité trompeuse ENTERPRISE.

**Sortie 9.6 : mécanisme commercial V1 prouvé ; reprise Phase 10 ensuite.**

**Suivi GitHub :** [issue #123](https://github.com/jupi-z/Monarque-Connect/issues/123).
