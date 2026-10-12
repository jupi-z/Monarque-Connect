# 57 — Spécification d'exécution Phase 2 — Product Entitlements

## Objectif

Transformer la projection `capabilities` de Phase 1 en une décision commerciale et technique autoritative, déterministe et auditable pour chaque organisation et établissement.

## Périmètre

- catalogue versionné des modules commercialisables ;
- plans versionnés, devise, période et limites ;
- abonnements d'organisation avec état, dates d'effet et transitions ;
- entitlements effectifs par organisation, module et établissement ;
- overrides d'organisation `ALLOW`, `DENY` et `LIMIT_OVERRIDE`, bornés dans le temps, justifiés et audités ;
- presets métier persistés comme recommandations d'onboarding, sans devenir une autorité d'autorisation ;
- quotas consommables, réservations et refus atomiques ;
- activation/désactivation contrôlée des modules ;
- résolution des capabilities à partir de données persistées, jamais d'un tableau en mémoire ;
- audit et Domain Events transactionnels pour chaque mutation du Control Plane.

## Invariants de sortie

1. Une organisation ne peut utiliser qu'un module explicitement accordé par un entitlement actif; une inclusion au plan est distincte de l'activation par défaut.
2. Toute décision d'accès est recalculée avec l'organisation, l'établissement actif, l'état de l'abonnement et la version du plan.
3. Les dates d'effet, expirations et transitions sont déterministes en UTC et testées aux bornes.
4. Un quota ne peut jamais devenir négatif, même sous concurrence ; la consommation et sa réservation sont atomiques.
5. La désactivation d'un module retire immédiatement l'accès aux endpoints métier concernés sans supprimer l'historique d'audit.
6. Les entitlements ne permettent jamais de franchir les contrôles Identity/Tenancy de Phase 1.
7. Toute mutation du Control Plane crée son audit et son événement dans la même transaction via l'Outbox Writer.
8. Les capabilities exposent la décision effective, sa version et la raison de chaque refus exploitable par le Web Client.
9. Un `ALLOW` explicite peut ouvrir un module hors plan, un `DENY` explicite prime sur tout autre droit, et `LIMIT_OVERRIDE` ne modifie que les limites indiquées.
10. Les périodes de quota sont calculées côté serveur à partir du plan effectif; les compteurs sont consommés atomiquement lors de la création des ressources concernées.
11. Les abonnements effectifs ne peuvent pas avoir de fenêtres temporelles qui se chevauchent, y compris sous concurrence, grâce à une contrainte PostgreSQL.

## Modèle conceptuel minimal

- `module_catalog` : code stable, version, état publié, dépendances et métadonnées client ;
- `plans` / `plan_versions` : offre commerciale immuable par version ;
- `subscriptions` : abonnement courant et historique par organisation ;
- `entitlements` : droit accordé, source, période, scope et état ;
- `module_business_type_presets` : recommandations persistées par type d'entreprise ;
- `organization_entitlements` : overrides plateforme et limites ciblées ;
- `quota_definitions` / `quota_allocations` / `quota_ledger` : limite, réservation et consommation auditable ;
- `module_activations` : activation explicite et transitions idempotentes.

Les identifiants commerciaux et versions sont immuables après publication. Les corrections se font par nouvelle version et non par réécriture historique.

## API client critique

- `GET /organizations/{organizationId}/capabilities` devient la projection effective versionnée ;
- `GET /organizations/{organizationId}/modules` expose le catalogue visible et l'état d'activation ;
- `PATCH /organizations/{organizationId}/modules/{moduleCode}` active ou désactive un module selon les permissions et entitlements ;
- `GET /organizations/{organizationId}/quotas` expose les limites et consommations ;
- `GET/POST /platform/organizations/{organizationId}/entitlements` expose la lecture et l'écriture contrôlées des overrides plateforme ;
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
- la création d'une organisation provisionne le plan CONNECT par défaut (ou le plan demandé) et consomme les quotas owner/établissement dans la transaction ;
- l'acceptation d'une invitation et la création d'un établissement refusent atomiquement tout dépassement de quota.

## Hors périmètre

La facturation réelle, les paiements, les taxes, les coupons et le catalogue public multi-vendeur restent hors Phase 2. Ils seront traités après stabilisation du Control Plane.
