# C3 — Preuves de clôture technique

**Périmètre :** Shared Catalog, Pricing, Measures & FX.  
**Décision :** C3 clôturé techniquement; aucun travail C4–C8 n'est inclus.  
**Main final vérifié :** `46b8b61b1ed670cd0b6e7c433db1986da61d468d`.  
**PR finale :** [#187 — révocation append-only des devis](https://github.com/jupi-z/Monarque-Connect/pull/187).

## 1. Livrables intégrés

- C3.2: catalogue canonique basé sur `Item`, variantes, offres, mesures et conversions dimensionnelles, migrations et tests; preuves dans [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md).
- C3.3: prix commerciaux versionnés distincts de FairScale SaaS, registre FX versionné, policies, calcul Decimal, quotes et snapshots persistés; historique détaillé dans [Docs/125](125_C3_3_PRICE_VERSION_EXECUTION_STATUS.md).
- Résolution de contexte fiscal et de réductions versionnées, fail-closed quand une configuration applicable manque; contrat et limites dans [Docs/126](126_C3_TRUSTED_TAX_AND_DISCOUNT_RESOLUTION_CONTRACT.md).
- C3.4: révocation append-only des quotes, unique par quote/tenant, permission OWNER/ADMIN, revalidation tenant/produit/établissement, idempotence, audit et Outbox atomiques. Le snapshot financier reste immuable; les lectures et rejeux indiquent `REVOKED`.

Les montants et quantités critiques utilisent des représentations décimales contrôlées; les conversions dimensionnelles et le scénario synthétique `0,125 kg × 20 USD/kg × 2 360 CDF/USD = 5 900 CDF` sont couverts par les preuves C3 précédentes. Les règles fiscales sont une abstraction paramétrable et ne constituent aucune affirmation de conformité légale.

## 2. Traçabilité de la livraison finale

| Événement | SHA | Résultat vérifié |
|---|---|---|
| Head PR #187 | `a9ebb59f75a145dc79a1a93cb18308495c513651` | CI PR [run 40850299703](https://github.com/jupi-z/Monarque-Connect/actions/runs/40850299703), job `validate-pr / validate`: success |
| Merge squash PR #187 | `46b8b61b1ed670cd0b6e7c433db1986da61d468d` | PR marquée fusionnée par GitHub |
| CI post-fusion `main` | `46b8b61b1ed670cd0b6e7c433db1986da61d468d` | [run 40851397121](https://github.com/jupi-z/Monarque-Connect/actions/runs/40851397121), job `validate-main / validate`: success |

La CI PR finale inclut lint, typecheck, Prisma generate/validate, preuves de migrations depuis les états configurés par le workflow, OpenAPI/contrats, unitaires, intégration PostgreSQL, E2E, répétitions CRM/Phase 1, build de production et smoke HTTP. Les mêmes contrôles complets ont été exécutés après fusion sur `main`.

Les tentatives antérieures ne sont pas effacées : run [40848567163](https://github.com/jupi-z/Monarque-Connect/actions/runs/40848567163) a détecté des accès `any` non typés dans le nouveau test; run [40848958002](https://github.com/jupi-z/Monarque-Connect/actions/runs/40848958002) a révélé le chemin de révocation absent du contrat proposé et l'enum incomplet; run [40849607488](https://github.com/jupi-z/Monarque-Connect/actions/runs/40849607488) a révélé le désaccord entre la réponse runtime `201` et le test/contrat `200`. Chaque échec a été corrigé avant le run final vert, sans supprimer ni assouplir les tests concernés.

La migration C3.4 `20261029110000_c3_quote_revocations` est incluse dans les validations CI; elle crée le registre append-only, les contraintes de portée et le mécanisme PostgreSQL d'immuabilité. Aucun test lourd, Docker, build ou migration n'a été exécuté sur le poste local.

## 3. Gates C3 et limites

| Gate | État |
|---|---|
| Catalogue canonique, variantes et unités | PASS — preuves PR C3.2 et CI enregistrées dans Docs/124 |
| Tarifs versionnés, FX et calcul exact | PASS — preuves C3.3 dans Docs/125 |
| Résolution versionnée des remises et contextes fiscaux | PASS techniquement — règles de configuration fail-closed et snapshots versionnés |
| Révocation, autorisation, idempotence, audit/Outbox et immuabilité | PASS — PR #187, CI PR et post-fusion ci-dessus |
| OpenAPI, contrats, migrations, suites applicables et build | PASS — CI PR et post-fusion complètes |
| Fournisseur FX réel configuré | NOT CONFIGURED — abstraction disponible; aucune source live réputée active |
| Validation fiscale/juridique ou homologation | NOT VERIFIED — aucune conformité déclarée |
| PSP réel, POS transactionnel, fiscalisation officielle, production | OUT OF SCOPE / NOT STARTED — relèvent de gates et lots ultérieurs |

La clôture est technique et n'autorise ni la commercialisation, ni le POS C4, ni les phases suivantes. Les snapshots des transactions existantes n'ont pas été réinterprétés; aucune migration historique n'a été réécrite.

## 4. Décision

**GO — C3 est techniquement clôturé sur `main@46b8b61`; C4 reste en attente d'une autorisation distincte.** L'issue de suivi C3 #171 peut être clôturée après synchronisation de ce document et vérification de la CI de la PR documentaire. Les gates FX live, fiscalité, PSP, opérations et production demeurent explicitement ouverts.
