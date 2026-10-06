# 25 — Exigences non fonctionnelles

## Fiabilité
- aucune donnée critique seulement en mémoire ;
- transactions pour cohérence multi-écriture ;
- opérations critiques retry-safe ;
- zéro migration destructive non planifiée.

## Performance MVP
Sur staging de référence :
- p95 lecture courante ≤ 400 ms ;
- p95 écriture courante ≤ 700 ms ;
- 5xx < 1 % sous baseline ;
- test 50 VU minimum avant release.

## Scalabilité
API stateless, stockage partagé, pagination curseur. Plusieurs instances doivent pouvoir servir la même DB sans perte fonctionnelle.

## Disponibilité
Objectif interne initial : 99,5 % mensuel hors maintenance planifiée. Pas un SLA contractuel sans validation business.

## Accessibilité client
Les frontends futurs doivent viser WCAG 2.2 AA sur les parcours critiques.

## Réseau
Le backend doit rester utilisable dans des conditions de bande passante modeste : payloads bornés, pagination, compression HTTP, pas de sur-fetching massif.

## Entitlements et permissions

- résolution d'une capability courante : cible p95 ≤ 50 ms hors latence réseau, cache interne autorisé si invalidation sûre ;
- retrait d'entitlement/suspension : aucune dépendance à l'expiration d'un cache client ;
- agrégations et listes appliquent tenant + establishment scope avant calcul/pagination.

## Évolutivité produit

Ajouter un business type ou une version de plan ne doit pas nécessiter de fork applicatif. Ajouter un module peut nécessiter du code, mais son activation commerciale doit passer par le catalogue/entitlements communs.

## Intelligence

Les dashboards MVP doivent rester exploitables sans infrastructure analytique distribuée. Les calculs coûteux sont profilés avant introduction d'un datastore spécialisé.

## AI-native NFR

- émission outbox dans la même transaction : pas de fenêtre de perte entre état et événement ;
- traitement eventuel : at-least-once, retry borné, dead-letter/review state documenté ;
- event consumers horizontaux et idempotents ;
- panne Intelligence/AI Gateway n'empêche pas login, ventes, achats, facturation, stock ou caisse ;
- provider timeout configurable ;
- coût IA mesurable par tenant/feature ;
- retrieval tenant-scoped avant scoring/vector search ;
- toute feature probabiliste possède kill switch sans migration de données ;
- model/provider replacement ne change pas les contrats métier.
