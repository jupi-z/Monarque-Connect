# 55 — Seed et baseline des données de référence

## Finalité

Le seed fournit uniquement les données de référence nécessaires au fonctionnement déterministe de la Phase 2. Il est idempotent, rejouable et ne réécrit pas une version de plan publiée.

## Référentiels livrés

- cinq types d'entreprise actifs : `COMMERCE_DISTRIBUTION`, `SERVICE_PROVIDER`, `MINING_SUPPLIER_B2B`, `SMALL_INDUSTRY` et `OTHER` ;
- catalogue des modules core et commerciaux défini dans `prisma/seed.ts` ;
- recommandations de modules persistées dans `module_business_type_presets` ;
- plans `CONNECT`, `OPERATIONS`, `BUSINESS` et `ENTERPRISE`, chacun avec une version active `1` ;
- modules inclus, `defaultEnabled` et quotas `MAX_USERS`/`MAX_ESTABLISHMENTS` par version de plan ; ces deux quotas sont de mode `CAPACITY`.

## Règles d'exploitation

1. Une nouvelle recommandation métier est ajoutée par une modification explicite du seed et une migration si le schéma évolue.
2. Une version active de plan est immuable : une correction commerciale crée une nouvelle version.
3. Le seed ne donne jamais à lui seul un droit d'accès : le resolver combine organisation active, abonnement effectif, inclusion au plan, overrides, activation et dépendances.
4. Les presets sont des recommandations d'onboarding et ne remplacent ni une permission ni un entitlement.
5. Une organisation créée par le parcours public reçoit toujours `CONNECT`. Une attribution commerciale supérieure passe par une procédure plateforme autorisée et n'est jamais choisie par le client.
6. Les quotas initiaux du owner et de l'établissement principal sont consommés dans la transaction de création.

## Preuves

Les tests `tests/entitlements/catalog-and-plans.integration.test.ts` vérifient le seed idempotent, l'immutabilité des versions et les invocations concurrentes. Les tests d'entitlements vérifient que les recommandations ne deviennent pas une autorité d'autorisation.
