# Phase 11.5 — Agent Runtime partagé et intégration ZAMUREK

**PLANNED.** Dépend de 10A.5 + 10B. L'Agentic Fabric doit être **unique** : Monarque Connect détient outils/acteurs/policies/workflows/mémoires; ZAMUREK déclare ses outils métier.

## Runtime
- Identity `AgentPrincipal` avec délégation du user/org/établissement, scopes, expiry et plafond ; aucune identité de super-admin impersonnable.
- Registry versionné `ToolDefinition` JSON Schema ; tool handlers sur les use cases canoniques, jamais Prisma direct depuis un modèle.
- Classes A0 READ, A1 DRAFT, A2 REVERSIBLE, A3 HIGH_IMPACT (approval humaine), A4 PROHIBITED, alignées à `Docs/47`. Revalidation au commit de l'opération.
- Journal durable `AgentRun/Step/Approval/ToolOutcome`, checkpoints, retry, idempotency, compensation, budget, kill-switch global/tenant.
- Mémoire restreinte by org/establishment/user opt-in, TTL, provenance, effacement, consent, redaction ; modèle fournisseur interchangeable.
- Outils ZAMUREK : read public catalogue, FAQ, availability, preview devis, résumés KPI, proposition de menu ; **aucune émission de facture, paiement cash, changement de prix/FX ni mouvement caisse autonomes** sans approval et commande backend.
- Tests cross-tenant, prompt injection venue, validation payloadHash expiry, approbateur sans permission, replay, provider downtime et repli sûr.

## Gate
CLI/tests des tool contracts et effets persistants, 3 assistants ZAMUREK prouvés en 1.0.0, aucune fuite ni écriture A3 autonome, features off sans dégrader les ventes, CI et preuve de coût.
