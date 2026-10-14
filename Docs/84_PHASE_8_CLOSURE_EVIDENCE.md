# 84 — Phase 8 Projects & Documents — Preuve de clôture

## Décision

La Phase 8 — Projects & Documents est clôturée techniquement à 100 % sur
`main@6105806790994f98f8fa33ace520a412bebbd05b`.

La clôture porte sur le périmètre livré `Project → Task → Document/Media
links`. Elle ne crée pas de fournisseur de stockage obligatoire, de recherche
full-text, de collaboration temps réel, de workflow de signature ou de règle
fiscale/réglementaire nouvelle.

## Provenance vérifiable

- Baseline d'ouverture après cadrage :
  `main@318b3e5da5ddf257355b2d87d40cdcc5af8f571b`.
- Branche d'implémentation : `monarque/phase8-implementation`.
- PR d'implémentation : [#108](https://github.com/jupi-z/Monarque-Connect/pull/108).
- SHA de tête soumis à la PR :
  `19a4328a1b996dae107e873bbae86a389e67238b`.
- Fusion contrôlée par squash :
  `6105806790994f98f8fa33ace520a412bebbd05b`.
- Branche de travail distante supprimée après fusion ; `main` est la seule
  branche distante conservée au moment de cette clôture.

## Contrôles GitHub Actions

### CI de la PR

[Backend CI #291](https://github.com/jupi-z/Monarque-Connect/actions/runs/38631368687)
sur le SHA de tête `19a4328…` : `success`.

Le job `validate` a réussi toutes les étapes obligatoires : installation,
audit runtime, lint, typecheck, validation Prisma, preuves de migrations,
OpenAPI, contrats, suite PostgreSQL, build et smoke HTTP.

Résultats observés dans les logs :

- 252 tests Vitest réussis ;
- 12 tests E2E HTTP réussis, dont la suite Phase 8 ;
- 166 opérations OpenAPI valides ;
- migration base vide et upgrade depuis Phase 7 validés ;
- build et endpoints health validés.

### CI post-fusion

[Backend CI #292](https://github.com/jupi-z/Monarque-Connect/actions/runs/38632232038)
sur `main@6105806…` : `success`.

Le job `validate` a réussi les mêmes contrôles sur le commit réellement
fusionné, avec PostgreSQL 17 pour les preuves de migration et les tests
d'intégration. Les étapes terminées avec succès incluent explicitement les
migrations des Phases 1, 2, 4, 5, 6, 7 et 8, `npm test`, `test:e2e`, build,
contrats OpenAPI et smoke HTTP.

### CI finale après clôture documentaire

[Backend CI #294](https://github.com/jupi-z/Monarque-Connect/actions/runs/38633825488)
sur `main@b348c6026b489bc29f0e3e2295160eb5140c7355` : `success`.

Cette exécution valide le dépôt tel qu'il est réellement conservé après la
fusion de la PR documentaire #109. Elle répète les migrations, la suite
PostgreSQL, les E2E, OpenAPI, les contrats, le build et le smoke HTTP sans
régression.

## Couverture fonctionnelle et invariants

- Project et Task sont establishment-scoped, avec transitions explicites,
  validations de références et écriture état + audit + Outbox transactionnelle.
- Les autorisations réutilisent `AuthorizationService`, les entitlements
  existants, les permissions centrales et les scopes établissement.
- Les documents restent tenant-scoped ; les cibles de liens sont allowlistées
  et les références cross-tenant/cross-establishment sont refusées sans fuite.
- Les mutations rejouables utilisent une clé d'idempotence et un hash
  canonique ; un même identifiant avec une commande différente retourne `409`.
- Les octets passent par l'interface `StorageAdapter` et ne sont jamais
  exposés directement au client ou stockés dans PostgreSQL.
- Les événements Phase 8 sont versionnés et enregistrés dans l'Outbox dans la
  même transaction que l'état métier ; le consumer de receipts est rejouable.
- La migration `20261014210000_add_projects_documents` est additive et les
  migrations historiques des Phases 0 à 7 n'ont pas été modifiées.

## Gouvernance et réserves

- Aucun push direct sur `main` n'a été utilisé pour l'implémentation.
- La PR #108 a été fusionnée uniquement après CI PR verte et avec SHA attendu.
- La protection native de `main` reste suivie séparément dans l'issue #6 ; la
  politique compensatoire branche → PR → CI → squash merge reste obligatoire.
- Les avertissements GitHub sur la dépréciation Node.js 20 des actions et la
  migration future de `ubuntu-latest` ne sont pas des échecs de la Phase 8,
  mais restent des sujets de maintenance à traiter dans la gouvernance CI.

## Conclusion

Les gates de sortie de la livraison initiale de la Phase 8 sont prouvées par le
dépôt, les PR #108/#109 et les exécutions GitHub Actions #291/#292/#293/#294
référencées ci-dessus. La stabilisation corrective post-clôture est maintenant
prouvée par la PR #112 et `Docs/85_PHASE_8_DOCUMENTS_HARDENING_EVIDENCE.md` ;
elle ne réécrit pas les preuves historiques et ne rouvre pas les modèles des
phases précédentes.

## Addendum post-clôture — 2026-10-14

L'audit indépendant a identifié trois écarts qui empêchaient de considérer la
Phase 8 comme strictement sans dette : l'adaptateur mémoire pouvait finaliser
un upload sans octets vérifiés, les lectures de documents ne validaient pas les
permissions de leurs cibles métier, et `complete`/`revoke` pouvaient muter le
stockage avant la validation transactionnelle. La PR corrective dédiée
[#112](https://github.com/jupi-z/Monarque-Connect/pull/112) a été fusionnée
après CI verte ; ses preuves sont détaillées dans
`Docs/85_PHASE_8_DOCUMENTS_HARDENING_EVIDENCE.md`.

La migration additive `20261014230000_harden_document_upload_sessions` conserve
le token opaque et l'expiration d'une session pour que les retries idempotents
ne dépendent pas d'une reconstruction artificielle du token. Aucun historique
de migration n'est modifié.
