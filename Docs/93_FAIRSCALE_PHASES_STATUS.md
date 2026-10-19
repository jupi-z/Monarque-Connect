# 93 — Statut FairScale V1

**Baseline de préparation : main@becef9a96163b2331e1d459583d6dde551857c73 ; Phase 9 clôturée.**
**Au 19/10/2026 : Phase 9.5 clôturée sur `main@0fb133fdfc4a6eb6e1a76389e4eb0bd203a976dd`; Phase 9.6 non commencée.**

| Gate | Phase 9.5 | Phase 9.6 |
|---|---|---|
| Norme/ADR revus et fusionnés | [x] | prérequis |
| OpenAPI contract-first | [x] | [ ] |
| Migrations neuves et upgrade | [x] | [ ] |
| Catalogue USD et prix versionnés | [x] | dépendance |
| Retrait du plafond paid users + addons | [x] | dépendance |
| Unicité welcome/politique annuelle | [x] calcul | [ ] encaissement |
| Devis et quote serveur | [x] | usage commercial |
| Invoices et paiements de la plateforme | — | [ ] |
| Webhooks/adaptateurs et incidents | — | [ ] |
| Commandes Billing du Control Plane | — | [ ] |
| Test des frontières Phases 0–9 | [x] | [ ] |
| CI PR et post-fusion sur main | [x] | [ ] |
| Preuves de clôture versionnées | [x] | [ ] |

Ne jamais clôturer sur la seule écriture du code. Exiger CI GitHub, migrations base vide et upgrade, régressions, preuves Docs/92, PR fusionnée et état mis à jour. La Phase 11 Control Plane globale ne se réduit pas à ses commandes Billing livrées en 9.6.

Liens : [FairScale V1](89_FAIRSCALE_V1_NORMATIVE_SPEC.md) · [Phase 9.5](90_PHASE_9_5_FAIRSCALE_CORE_EXECUTION_SPEC.md) · [Phase 9.6](91_PHASE_9_6_FAIRSCALE_BILLING_EXECUTION_SPEC.md) · [acceptation](92_FAIRSCALE_V1_ACCEPTANCE_MATRIX.md) · [ADR-038](94_ADR_038_FAIRSCALE.md).

Preuve de clôture 9.5 : [Docs/96](96_PHASE_9_5_FAIRSCALE_CLOSURE_EVIDENCE.md). Les gates 9.6 restent volontairement ouverts jusqu'à l'intégration d'un paiement vérifié ou d'un canal manuel contrôlé et audité.

## Tickets de réalisation
- [Phase 9.5 — issue #122](https://github.com/jupi-z/Monarque-Connect/issues/122)
- [Phase 9.6 — issue #123](https://github.com/jupi-z/Monarque-Connect/issues/123)
- [Prompt Codex de référence](95_CODEX_FAIRSCALE_EXECUTION_PROMPT.md)
