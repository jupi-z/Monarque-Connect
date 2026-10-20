# 100 — Phase 9.6 : preuve de stabilisation corrective FairScale V1

**Statut :** correctifs techniques en cours de revue sur branche dédiée ; aucune clôture commerciale n'est déclarée ici.

**Baseline auditée :** `main@4a30124f1b975f0737e14ce59dbe84aacb65b700`.

## Périmètre de cette passe

Cette passe répond aux constats FS-AUD-001 à FS-AUD-010 et aux contrôles directement démontrables de FS-AUD-012/014, sans refondre les phases antérieures :

- remise welcome mensuelle durable, limitée aux échéances payées et consommée atomiquement avec l'encaissement ;
- période canonique pour l'activation initiale et les renouvellements, y compris les fins de mois ;
- statut `PAST_DUE` cohérent avec une grâce de sept jours, puis suspension ;
- paiement vérifié obligatoire avant l'effet d'un changement de plan, de périodicité ou d'une extension payante ;
- capacité effective dérivée des extensions actives et réutilisée par Billing et Quota ;
- sélection des prix commerciaux selon l'horloge serveur, sans date historique contrôlée par le client ;
- versions `PlanVersion` USD alignées sur les deux périodes FairScale ;
- seed non destructif pour les prix publiés et empreinte complète des commandes de publication ;
- vérification explicite et auditée des `BillingCustomer`, distincte du paiement ;
- rattachement plateforme contrôlé d'une organisation à une identité Billing existante, avec refus des doubles rattachements.

## Complément FS-AUD-016 — extensions à la première activation

La contre-vérification a identifié que le paiement initial persistait le montant des extensions dans le devis, le contrat et la facture, mais ne matérialisait pas les lignes `BillingSubscriptionAddon`. La capacité effective ne pouvait donc pas refléter immédiatement les établissements supplémentaires achetés.

Le correctif crée maintenant, dans la même transaction que l'activation après paiement vérifié, une ligne `BillingSubscriptionAddon` par extension économique du devis (`ESTABLISHMENT`, quantité, période, devise, prix unitaire et date d'effet). Le renouvellement réutilise ensuite cette ligne comme source de vérité pour la facturation et la capacité.

La preuve E2E couvre le parcours HTTP suivant : devis BUSINESS pour cinq établissements, paiement TEST vérifié, vérification Billing contrôlée, capacité effective de cinq établissements, puis renouvellement payé avec une ligne d'extension de 2 000 centimes. La preuve est ajoutée dans `tests/e2e/phase9-6-billing.e2e.test.ts`.

## Preuves locales exécutées

Les résultats ci-dessous sont des preuves locales reproductibles ; ils ne remplacent pas la CI GitHub obligatoire :

| Contrôle | Résultat |
|---|---|
| `npm run lint` | réussi |
| `npm run typecheck` | réussi |
| `npm run prisma:validate` | réussi |
| `npm run openapi:validate` | 196 opérations valides |
| `npm run contracts:validate` | contrats et exemples valides |
| `npm run prisma:phase96:migration-proof` | réussi : 53 migrations depuis zéro, upgrade 46 + 7 |
| Lifecycle FairScale PostgreSQL | 7 tests réussis |
| Billing admin PostgreSQL | 3 tests réussis |
| FairScale catalog PostgreSQL | 4 tests réussis |
| FairScale HTTP E2E | 2 tests réussis |
| E2E initial addons + renouvellement | 3 tests réussis sur la suite Billing HTTP |
| `npm run build` | réussi |

## Migrations additives

- `20261019170000_phase96_scheduled_change_payment_gate`
- `20261019173000_phase96_billing_customer_verification`
- `20261019174000_phase96_billing_identity_link_audit`

Ces migrations ajoutent le lien facture/changement programmé, les receipts de vérification Billing et l'action d'audit d'identité. Aucune migration historique n'est réécrite.

## Limites qui restent explicitement ouvertes

Cette preuve ne constitue pas une autorisation de commercialisation. L'issue #123 reste ouverte jusqu'à la preuve d'un fournisseur de paiement réel vérifié ou d'un circuit manuel contrôlé, au rapprochement opérationnel, aux sauvegardes/restaurations et à la validation fiscale/juridique. La CI PR et post-fusion correspondante est maintenant vérifiée ; voir la clarification de provenance datée ci-dessous.

Le fournisseur `TEST` reste réservé à l'environnement de test et ne peut pas être utilisé comme moyen de paiement de production.

Les notifications désordonnées, remboursements/chargebacks et contrôles d'infrastructure de runner doivent rester couverts par la matrice finale et les gates opérationnelles de [Docs/99](99_PHASE_9_6_OPERATIONAL_CLOSURE_PLAN.md).

## Clarification de provenance — 20/10/2026

Cette preuve a été rédigée avant la fusion des correctifs. Les PR #139 et #140 ont depuis été fusionnées dans `main`; la livraison complémentaire d'activation initiale des extensions est dans [PR #140](https://github.com/jupi-z/Monarque-Connect/pull/140), merge commit `26cf9c5e71d83674c2c8954f7c3eda00874293ea`. Son check PR `validate-pr / validate` a la conclusion `SUCCESS` dans [Backend CI #39395508774](https://github.com/jupi-z/Monarque-Connect/actions/runs/39395508774). Le check `validate-main / validate` post-fusion est `SUCCESS` dans [Backend CI #39397452560](https://github.com/jupi-z/Monarque-Connect/actions/runs/39397452560), sur ce même SHA. Cette clarification ne réécrit pas les preuves locales historiques ci-dessus et ne ferme pas les gates externes de commercialisation de l'issue #123.
