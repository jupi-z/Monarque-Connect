# Contrats normatifs inter-produit — Monarque Connect Core ↔ ZAMUREK V1

**Statut : architecture à implémenter, pas API actuellement disponible.** Toute API de ce document doit être marquée `PLANNED` jusqu'à preuve par tests. **Les arbitrages qui résolvent les incompatibilités avec le schéma existant figurent dans [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), en particulier B-01 à B-06.**

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
| `PlaceCommercialOrder` | Core Sales | Contrôle ownership+establishment, idempotence, snapshot prix/offre |
| `CapturePosTender` | Core POS/Sales/Cash | Règlement autorisé via Invoice **canonique obligatoire** puis PaymentRecord (`invoiceId` non-null), mouvement Cash net si espèces, stock et Outbox dans **transaction interne unique** ; PSP externe hors transaction |
| `IssueCommercialDocument` | Core Sales/Documents | Numérotation, Invoice interne distincte de reçu/tax-invoice imprimable, stockage durable, preuve fiscalisation externe si exigée ; aucune fausse authentification DGI |
| `JoinOrLeaveVenue` | Venue module | Consentement opt-in, projection publique filtrée, révocation/invalidation |
| `RegisterBooking` | Vertical services | Slots/staff/tables, contraintes concurrence DB, identité et policy |
| `InvokeAgentTool` | Core Intelligence | Actor+scope tenant/establishment+approval; domaine métier revalide à exécution |

## Versionnement

**Compatibilité stricte** : `resolveEffective(organizationId)` désigne toujours Monarque Connect ; les nouveaux clients demandent explicitement `productCode` et capabilities v2 si la projection change. Ne pas convertir silencieusement `Subscription` mono-produit en resolver arbitraire. Les permissions `pos:*` sont des scopes d'actions, pas un accès universel à SALES/CASH.

- REST `/api/v1/` suivant convention Monarque Connect existante ; ne pas introduire simultanément un autre préfixe `/v1` non traduit. La façade de canal peut exposer sous-chemins `/api/v1/zamurek/*` avec vérifications d'accès. `X-Zamurek-Channel` identifie le canal pour résolution **seulement**, pas un droit.
- Contrat canonique des ressources partagées produit depuis **Monarque Connect** et versionné dans `openapi/` + schémas `contracts/`. Le repo ZAMUREK conserve un **contrat d'intégration client** générable à partir du canonique, avec version/commit source attestés. Aucun double schéma défini manuellement sans test de diff.
- Événements enveloppés selon `Docs/43_DOMAIN_EVENT_CONTRACT.md`, pas un second format incompatible ; événements ZAMUREK documentés/ajoutés à la même Event Fabric.
- Les changements breaking nécessitent stratégie version/API compatibility clients APK/EXE déployés.

## Confidentialité/qualité
Publication prix et factures CDF RDC selon avis juridique ; policy fiscale bloquante si fiscalisation requise. Stockage des historiques de commande/finance dans les tables canoniques, aucune réplication durable financière côté ZAMUREK. Venue reçoit **uniquement** offres opt-in accessibles publiquement ; désactivation purge projections / cache selon SLO documenté.

## Test contractuel minimal
T1 vend dans deux établissements d'une organisation ; T2 externe ; clients C1/C2 ; opérateur venue V ; cashier W. T1 ne voit pas T2 ; W ne crée pas de paiement d'un autre établissement, V ne lit aucun paiement ; retry concurrent POS enregistre 1 order+1 PaymentRecord+1 mouvement cash+1 outbox ; report PDF/ticket réfère facture canonique. Souscription ZAMUREK BASIC ouvre ses features et non CRM ni modules BUSINESS. Le prix USD→CDF 125g est déterministe sans float.
