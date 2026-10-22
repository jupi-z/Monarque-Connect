# Premier prompt Codex — phase 10A.5 Monarque Connect × ZAMUREK

> **Statut : proposition de prompt, exécuter seulement après revue/merge de cette branche de planification.** Travailler **dans le clone local du dépôt privé Monarque Connect**, branche dédiée/PR ; ne jamais envoyer de code du Core dans le dépôt public ZAMUREK.

```text
Tu travailles sur https://github.com/jupi-z/Monarque-Connect, dépôt privé déjà cloné, sur une branche de travail propre créée à partir du dernier main validé.

Ta mission est la PHASE 10A.5 — convergence du Core partagé avec ZAMUREK. NE COMMENCE PAS la phase 10B ni un nouveau backend ZAMUREK. Lis intégralement Docs/104 à 108, Docs/21, Docs/33, Docs/42, Docs/43, Docs/46, Docs/47, Docs/48, Docs/89, Docs/93, Docs/99, Docs/102 et Docs/103. Source partenaire : https://github.com/jupi-z/ZAMUREK (références de planification à jour, pas dépendance à du code commercial public).

Établis l'état réel du code, des tests et migrations, les commandes GitHub Actions récentes et la couverture des services Sales/Invoice/Payment/Cash/Catalog/Billing/Entitlements. Ne modifie aucune fonctionnalité close avant d'avoir enregistré les tests de non-régression.

Construis les lots C0–C8 selon Docs/105, en respectant ADR-039 et Docs/106. Le Core reste NestJS/Prisma/PostgreSQL monolithe modulaire avec organisation partagée isolation forte ; ZAMUREK n'obtient pas un autre moteur de vente/facturation/IA. Auth acheteur client public ≠ Membership staff ; vente de passage POS sans e-mail ; cash tender intégré dans transaction Sales/Payment/Cash unique ; documents imprimables versionnés et statut fiscal fail-closed ; USD source ZAMUREK avec snapshots CDF sans changer defaultCurrency des entreprises Monarque Connect ; produits et entitlements indépendants ; Agentic Fabric et Event Fabric uniques.

Travaille petit lot par petit lot avec migrations additives, tests de stockage PostgreSQL réel, sécurité BOLA, cross-establishment, cross-product, idempotence et rollback; adapte OpenAPI et contrats existants. Après chaque lot, produis le pourcentage vérifié du lot et de la phase selon Docs/108, avec tests/CI réellement exécutés, pas des fichiers simplement créés. Aucune clôture 10A.5 sans G-01→G-14 prouvés, sans fausse CI ni conformité fictive. Les externalités FairScale #123 demeurent ouvertes.

Git : petites PRs, CI obligatoire, pas de push direct main, aucun secret ou déploiement de production. Si une décision réglementaire ou contractuelle bloque un flux, documente-le et continue les lots indépendants. Signale exactement ce qui a réussi et ce qui reste bloqué.
```

La phase 10A.5 peut être traitée en plusieurs sessions Codex, mais aucune session ne doit déclarer toute la phase « done » sans les gates complets.
