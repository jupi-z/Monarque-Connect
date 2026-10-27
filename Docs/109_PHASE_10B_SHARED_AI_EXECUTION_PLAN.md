# Phase 10B — IA probabiliste gouvernée pour Monarque Connect ET ZAMUREK

**PLANNED — non implémentée. Dépend de C0–C3/C6/C7 de la phase 10A.5**, avec priorité aux contrats et sécurité communs. La phase 10A déterministe est close et ne sera pas réécrite. Les frontières d'identité, produit, permissions, retrieval et actions définies en [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md) sont des prérequis normatifs.

## Enjeux
Une seule `AI Gateway` + `Model Registry` + `TenantAiPolicy` + `Knowledge Layer` partagée. Les produits activent des capacités spécifiques par `productCode`, les agents ne possèdent pas de nouveau rôle omnipotent. Reprendre les protections de `Docs/42`, `Docs/46`, `Docs/47`, `Docs/48`.

## Implémentation
- `ModelGateway` provider-neutral; catalogue de modèles, coût/tokens/latence, budgets org et produit, taux, timeout et circuit-breaker ; implémentation provider réelle sous test.
- Classification/redaction/consentement et index retrieval par `organizationId`/`establishmentId`/`actor` ; aucune réutilisation de données privées cross-product sans autorisation.
- Knowledge minimum : catalogue public opt-in, FAQ/horaires, politiques publiées et résumé synthétique de ventes par permissions, provenance et fraîcheur garanties.
- Trois features d'assistance ZAMUREK V1 à terme : rédaction contrôlée de catalogue (draft), FAQ publique sourcée sans PII, synthèse d'exploitation depuis **KPI déterministes 10A** ; au moins une feature évaluée/activée dans 10B, les autres sur calendrier ZAMUREK 0.7.
- Pas de gateway LLM externe dans ZAMUREK. Modèle indisponible = Core transactionnel continue.
- Changement de modèle traité comme composant à risque ; metrics groundedness, abstention, coûts, prompt injection, jailbreak/tool poisoning, canaries, kill-switch.
- Compatibilité avec Agent Runtime 11.5 (pas d'agent généraliste capable de modifier caisse ou facture directement).

## Gate

**Invariants B-05/B-06/B-07 :** fonctions IA V1 en lecture explicative ou brouillon, sans droit d'écriture commerciale ni accès automatique inter-produits ; une indisponibilité de modèle n'affecte jamais `ConfirmPosSale`, invoice, stock ou cash. Journaux minimisés, budgets et quotas par organisation **et produit**, promesses de qualité seulement après évaluation versionnée.

Contrats / docs / tests tenant-scope, jeux d'évaluation versionnés, performances et budgets mesurés, taux fausses actions accepté avec seuil explicite, tests provider offline, sécurité/PII, rollback, CI PR/main. Ne pas attribuer à 10B la création de SalesOrder/POS : elle utilise des outils read-only validés du Core.
