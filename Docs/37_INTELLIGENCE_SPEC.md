# 37 — Monarque Intelligence MVP

## Positionnement

L'Intelligence MVP n'est pas une IA autonome. Elle transforme les données déjà structurées en **mesures, tendances et alertes déterministes**.

Cela permet de fournir de la valeur sans introduire prématurément modèles opaques, coûts d'inférence ou gouvernance cross-tenant complexe.

## KPI MVP

Exemples :
- ventes émises / période ;
- encaissements / période ;
- créances ouvertes ;
- taux de conversion quote→order ;
- dépenses / période ;
- solde de caisse dérivé ;
- valeur stock / ruptures selon données disponibles ;
- achats en attente ;
- projets en retard ;
- nombre d'opportunities actives ;
- inquiries réseau converties.

Tous les KPI doivent pouvoir être calculés organization-wide ou par établissement lorsque le scope le permet.

## Architecture

### Source
Tables transactionnelles PostgreSQL.

### Projection
Calcul synchrone pour métriques simples ou jobs idempotents/outbox pour projections plus coûteuses.

### MetricSnapshot
Utilisé lorsque conserver une valeur de période accélère les dashboards ou permet une tendance historique stable.

### InsightRule
Règle versionnée, déterministe et testable.

Exemples :
- invoice overdue ;
- stock below threshold ;
- project overdue ;
- cash anomaly simple ;
- RFQ sans réponse au-delà d'un délai.

### InsightAlert
Résultat durable d'une règle avec severity, statut et contexte minimal.

## Sécurité

- même tenant/scopes que la donnée source ;
- pas de KPI consolidé hors scope d'établissement ;
- pas de données d'un autre tenant ;
- aucune métrique "anonymisée" cross-tenant dans le MVP.

## Benchmarking futur

Le benchmarking agrégé est différé jusqu'à :
- politique de gouvernance ;
- seuils d'agrégation ;
- méthode d'anonymisation ;
- base contractuelle/légale validée ;
- tests de ré-identification adaptés.

## API

- overview ;
- metrics par code/période ;
- alerts list/acknowledge/resolve selon permission.

Les clients ne recalculent pas les KPI officiels à partir de données partielles.
