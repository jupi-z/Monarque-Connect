# 10 — Workflows commerciaux

## CRM
`Lead → Qualified → Opportunity → Quote`.

## Quote
`DRAFT → SENT → ACCEPTED | REJECTED | EXPIRED | CANCELLED`.

Une quote acceptée peut créer une SalesOrder de manière idempotente.

## Order
`DRAFT → CONFIRMED → FULFILLED | CANCELLED`.

Une order confirmée peut générer une Invoice. La fulfillment d'un produit stocké crée les mouvements `SALE_OUT`.

## Invoice
`DRAFT → ISSUED → PARTIALLY_PAID → PAID`.
`VOID` est une action explicite et auditée. Pas d'édition silencieuse après `ISSUED`.

## PaymentRecord
Enregistre un paiement constaté. Pas de débit carte/mobile money dans le MVP.  
Le total payé est la somme des records valides ; statut invoice dérivé/maintenu transactionnellement.

## Expense
`RECORDED → VOID` uniquement. Une correction se fait par annulation + nouvelle écriture, pas par réécriture historique arbitraire.

## Numérotation
Quote, Order, Invoice ont des séquences par organisation allouées transactionnellement.
