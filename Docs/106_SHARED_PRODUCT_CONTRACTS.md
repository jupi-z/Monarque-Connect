# Contrats normatifs inter-produit — Monarque Connect Core ↔ ZAMUREK V1

**Statut : contrats futurs `PLANNED`; les contrats internes de catalogue et de résolution produit pour C1 sont figés dans [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md).** Aucun endpoint de ce document n'est actuellement disponible du seul fait de cette spécification. Les arbitrages de compatibilité sont définis dans [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), B-00 à B-09.

## Identifiants, scopes, plan produit
- Identité applicative interne stable = `userId` (fédération future Monarque Auth/OIDC via couple `issuer + subject`, jamais rapprochement par e-mail) ; organisation commerciale = `organizationId` ; établissement = `establishmentId` ; canal public = `channelId`, **non secret** ; provenance `productCode=ZAMUREK|MONARQUE_CONNECT`.
- Customer n'a pas besoin de Membership staff pour voir son ordre ; l'accès public/acheteur est médié par ownership vérifié ou jeton client émis serveur, sans fuite de l'existence d'une commande.
- POS walk-in : `customerReference? = null` ou liaison `BusinessParty` anonymisée/tenant-scopée, **jamais** un faux e-mail/compte ou client `BusinessParty` global partagé. Comptoir toujours `cashierId`, `terminalId`, `cashSessionId` et établissement vérifiés.
- Vente : `SalesOrder.origin=BACKOFFICE|POS|ZAMUREK_ONLINE|RESTAURANT|SERVICE|REPAIR`, `sourceCommandId`, `priceQuoteRevision`, `totalSnapshot`; l'agrégat Order reste unique. Les commandes multi-vendeurs nécessiteraient un protocole distinct hors V1.
- Entitlements : `(organizationId, productCode, planVersion, moduleCode, action, establishmentScope, effectiveDate)`. Le prix SaaS est distinct du prix des ventes d'une organisation. Interdiction de dériver droits ERP du seul abonnement ZAMUREK.

## Contracts des commands (cibles internes, pas endpoints exécutables)
| Command | Propriétaire | Effet / invariant |
|---|---|---|
| `GetSellableOfferQuote` | Core Pricing/Catalog | Prix USD base canal ZAMUREK, FX exact, snapshots territoriaux, expiration |
| `PlaceCommercialOrder` | Core Sales | Initiation d'une commande online/à paiement différé ; contrôle ownership+establishment, idempotence et snapshot prix/offre ; ne marque jamais le paiement comme encaissé |
| `ConfirmPosSale` | Core POS/Sales/Cash | Commande canonique de finalisation POS pour un règlement dont la preuve est disponible localement (espèces ou mode manuel autorisé) ; orchestre dans une transaction Core unique l'ordre, l'Invoice canonique, le PaymentRecord lié (`invoiceId` non-null), le CashMovement net si espèces, les effets de stock autorisés, l'audit et l'Outbox |
| `CapturePosTender` | Port interne POS/Sales/Cash, non endpoint autonome | Sous-opération appelée uniquement par l'orchestrateur de finalisation ; ne peut créer un règlement isolé, contourner l'idempotence ou déclarer un PSP payé |
| `CreatePosPaymentIntent` / `FinalizeVerifiedPosPayment` | Core POS/Payments | Parcours électronique séparé : intention durable avant appel PSP hors transaction ; finalisation seulement après webhook signé/vérifié, dans une transaction Core créant les écritures canoniques nécessaires. Aucun succès ne provient d'une simple réponse client |
| `IssueCommercialDocument` | Core Sales/Documents | Rendu/versionnement et stockage durable post-commit ; Invoice interne distincte de `RECEIPT`/`TAX_INVOICE` imprimable ; aucune fausse authentification DGI. L'éligibilité fiscale dépend d'une règle juridictionnelle vérifiée |
| `JoinOrLeaveVenue` | Venue module | Consentement opt-in, projection publique filtrée, révocation/invalidation |
| `RegisterBooking` | Vertical services | Slots/staff/tables, contraintes concurrence DB, identité et policy |
| `InvokeAgentTool` | Core Intelligence | Actor+scope tenant/establishment+approval; domaine métier revalide à exécution |

## Versionnement

**Compatibilité stricte** : `resolveEffective(organizationId)` désigne toujours Monarque Connect ; les nouveaux clients demandent explicitement `productCode` et capabilities v2 si la projection change. Ne pas convertir silencieusement `Subscription` mono-produit en resolver arbitraire. Les permissions `pos:*` sont des scopes d'actions, pas un accès universel à SALES/CASH.

- REST `/api/v1/` suivant convention Monarque Connect existante ; ne pas introduire simultanément un autre préfixe `/v1` non traduit. La façade de canal peut exposer sous-chemins `/api/v1/zamurek/*` avec vérifications d'accès. `X-Zamurek-Channel` identifie le canal pour résolution **seulement**, pas un droit.
- Contrat canonique des ressources partagées produit depuis **Monarque Connect** et versionné dans `openapi/` + schémas `contracts/`. Le repo ZAMUREK conserve un **contrat d'intégration client** générable à partir du canonique, avec version/commit source attestés. Aucun double schéma défini manuellement sans test de diff.
- Événements enveloppés selon `Docs/43_DOMAIN_EVENT_CONTRACT.md`, pas un second format incompatible ; événements ZAMUREK documentés/ajoutés à la même Event Fabric.
- Les changements breaking nécessitent stratégie version/API compatibility clients APK/EXE déployés.

### Flux de règlement — contrat canonique

`PlaceCommercialOrder` ne règle pas une vente. Pour le POS espèces ou paiement manuel dont la preuve est contrôlée par le Core, `ConfirmPosSale` est l'unique commande publique d'orchestration ; `CapturePosTender` reste un port interne. Pour un PSP, `CreatePosPaymentIntent` prépare l'opération sans tenir de transaction DB ouverte pendant l'appel réseau, puis `FinalizeVerifiedPosPayment` consomme un événement authentifié et applique les écritures dans une transaction. Dans les deux cas, un `PaymentRecord` payé doit référencer l'`Invoice` canonique requise par le schéma actuel. Une clé réutilisée avec un payload économique différent retourne un conflit ; un rejeu identique ne recrée aucune écriture.

Ces noms décrivent des contrats PLANNED, pas des routes ou services déjà livrés. La cartographie C0 documente les transactions autonomes actuelles des services Sales/Cash/Inventory ; C4 devra introduire des primitives transaction-aware ou un orchestrateur interne propriétaire du client transactionnel, sans imbriquer les transactions publiques existantes.

## Confidentialité/qualité
Publication prix et factures CDF RDC selon avis juridique ; policy fiscale bloquante si fiscalisation requise. Stockage des historiques de commande/finance dans les tables canoniques, aucune réplication durable financière côté ZAMUREK. Venue reçoit **uniquement** offres opt-in accessibles publiquement ; désactivation purge projections / cache selon SLO documenté.

## Test contractuel minimal
T1 vend dans deux établissements d'une organisation ; T2 externe ; clients C1/C2 ; opérateur venue V ; cashier W. T1 ne voit pas T2 ; W ne crée pas de paiement d'un autre établissement, V ne lit aucun paiement ; retry concurrent POS enregistre 1 order+1 PaymentRecord+1 mouvement cash+1 outbox ; report PDF/ticket réfère facture canonique. Souscription ZAMUREK BASIC ouvre ses features et non CRM ni modules BUSINESS. Le prix USD→CDF 125g est déterministe sans float.
