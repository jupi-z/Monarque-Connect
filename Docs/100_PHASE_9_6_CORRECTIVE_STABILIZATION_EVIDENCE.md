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
| `npm run build` | réussi |

## Migrations additives

- `20261019170000_phase96_scheduled_change_payment_gate`
- `20261019173000_phase96_billing_customer_verification`
- `20261019174000_phase96_billing_identity_link_audit`

Ces migrations ajoutent le lien facture/changement programmé, les receipts de vérification Billing et l'action d'audit d'identité. Aucune migration historique n'est réécrite.

## Limites qui restent explicitement ouvertes

Cette preuve ne constitue pas une autorisation de commercialisation. L'issue #123 reste ouverte jusqu'à la preuve d'un fournisseur de paiement réel vérifié ou d'un circuit manuel contrôlé, au rapprochement opérationnel, aux sauvegardes/restaurations, à la validation fiscale/juridique et à la CI PR puis post-fusion sur `main`.

Le fournisseur `TEST` reste réservé à l'environnement de test et ne peut pas être utilisé comme moyen de paiement de production.

Les notifications désordonnées, remboursements/chargebacks et contrôles d'infrastructure de runner doivent rester couverts par la matrice finale et les gates opérationnelles de [Docs/99](99_PHASE_9_6_OPERATIONAL_CLOSURE_PLAN.md).
