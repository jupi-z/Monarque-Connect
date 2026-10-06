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
