# 57 — Spécification d'exécution Phase 2 — Product Entitlements

## Objectif

Transformer la projection `capabilities` de Phase 1 en une décision commerciale et technique autoritative, déterministe et auditable pour chaque organisation et établissement.

## Périmètre

- catalogue versionné des modules commercialisables ;
- plans versionnés, devise, période et limites ;
- abonnements d'organisation avec état, dates d'effet et transitions ;
- entitlements effectifs par organisation, module et établissement ;
- quotas consommables, réservations et refus atomiques ;
- activation/désactivation contrôlée des modules ;
- résolution des capabilities à partir de données persistées, jamais d'un tableau en mémoire ;
- audit et Domain Events transactionnels pour chaque mutation du Control Plane.

## Invariants de sortie

1. Une organisation ne peut utiliser qu'un module explicitement accordé par un entitlement actif.
2. Toute décision d'accès est recalculée avec l'organisation, l'établissement actif, l'état de l'abonnement et la version du plan.
3. Les dates d'effet, expirations et transitions sont déterministes en UTC et testées aux bornes.
4. Un quota ne peut jamais devenir négatif, même sous concurrence ; la consommation et sa réservation sont atomiques.
5. La désactivation d'un module retire immédiatement l'accès aux endpoints métier concernés sans supprimer l'historique d'audit.
6. Les entitlements ne permettent jamais de franchir les contrôles Identity/Tenancy de Phase 1.
7. Toute mutation du Control Plane crée son audit et son événement dans la même transaction via l'Outbox Writer.
8. Les capabilities exposent la décision effective, sa version et la raison de chaque refus exploitable par le Web Client.

## Modèle conceptuel minimal

- `module_catalog` : code stable, version, état publié, dépendances et métadonnées client ;
- `plans` / `plan_versions` : offre commerciale immuable par version ;
- `subscriptions` : abonnement courant et historique par organisation ;
- `entitlements` : droit accordé, source, période, scope et état ;
- `quota_definitions` / `quota_allocations` / `quota_ledger` : limite, réservation et consommation auditable ;
- `module_activations` : activation explicite et transitions idempotentes.

Les identifiants commerciaux et versions sont immuables après publication. Les corrections se font par nouvelle version et non par réécriture historique.

## API client critique

- `GET /organizations/{organizationId}/capabilities` devient la projection effective versionnée ;
- `GET /organizations/{organizationId}/modules` expose le catalogue visible et l'état d'activation ;
- `PATCH /organizations/{organizationId}/modules/{moduleCode}` active ou désactive un module selon les permissions et entitlements ;
- `GET /organizations/{organizationId}/quotas` expose les limites et consommations ;
- les endpoints métier utilisent un guard d'entitlement commun avant toute opération métier.

Les réponses d'erreur restent en RFC 9457 et distinguent identité, scope, entitlement inactif et quota épuisé sans révéler de données commerciales d'un autre tenant.

## Gates obligatoires

- migration depuis base vide et upgrade depuis la Phase 1 ;
- seed idempotent du catalogue de référence ;
- tests de concurrence sur quotas ;
- tests de transitions d'abonnement et d'expiration ;
- tests d'isolation tenant/établissement réutilisant l'autorisation de Phase 1 ;
- tests d'audit/outbox et d'idempotence des activations ;
- OpenAPI, contrats machine-readable, CI et revue PR verts ;
- aucun endpoint métier ne traite `modules: []` comme une autorisation implicite.

## Hors périmètre

La facturation réelle, les paiements, les taxes, les coupons et le catalogue public multi-vendeur restent hors Phase 2. Ils seront traités après stabilisation du Control Plane.
