# 37 — Monarque Intelligence

## Positionnement

Monarque Intelligence transforme les données structurées du Core en information exploitable, puis progressivement en assistance prédictive et agentique gouvernée.

Le système suit une progression stricte :

`Facts → Metrics → Rules → Predictions → Recommendations → Agent Proposals → Authorized Actions`

Chaque niveau dépend de la qualité et de la gouvernance du niveau précédent.

## Niveau 1 — Intelligence déterministe MVP

### KPI
- ventes émises / période ;
- encaissements ;
- créances ;
- conversion quote→order ;
- dépenses ;
- solde de caisse ;
- état stock ;
- achats en attente ;
- projets en retard ;
- pipeline CRM ;
- inquiries réseau converties.

### Rules / alerts
- invoice overdue ;
- stock below threshold ;
- project overdue ;
- document expiring ;
- RFQ sans réponse ;
- anomalies simples explicables.

Ces calculs ne nécessitent aucun modèle IA.

## Niveau 2 — Intelligence probabiliste

Activable feature par feature après validation :
- prévision de ventes ;
- prévision de rupture ;
- classification de demandes ;
- résumé de dossiers ;
- explication des variations KPI ;
- recommandations de réapprovisionnement ;
- aide à la priorisation CRM.

Une sortie est toujours accompagnée de contexte/provenance lorsque possible et peut s'abstenir si les données sont insuffisantes.

## Niveau 3 — Assistance conversationnelle

Un assistant futur peut répondre à des questions telles que :
- « Pourquoi mes marges baissent-elles ? »
- « Quelles factures nécessitent mon attention ? »
- « Quels achats devrais-je préparer ? »

Il interroge la Knowledge Layer avec le scope de l'utilisateur et ne dispose pas d'accès DB libre.

## Niveau 4 — Agents

Les agents futurs peuvent préparer des brouillons puis proposer des actions. Les actions passent par `47_AGENT_RUNTIME_AND_ACTION_POLICY.md`.

## Event-driven intelligence

Les projections Intelligence sont alimentées prioritairement par les DomainEvents et les données autorisées du Core.

Exemples :
- `invoice.issued` met à jour les métriques de facturation ;
- `payment.recorded` met à jour l'encaissement/DSO ;
- `stock.moved` alimente disponibilité/tendance ;
- `network.inquiry_received` alimente funnel réseau.

## Séparation transactionnel / intelligence

- le Core peut fonctionner sans Intelligence ;
- Intelligence peut être reconstruite ;
- une prédiction ne modifie pas un état métier ;
- un modèle n'est jamais la source de calcul officiel d'un montant ou d'un droit.

## Données inter-tenant

Le benchmarking cross-tenant reste hors MVP jusqu'à :
- gouvernance contractuelle/juridique ;
- anonymisation testée ;
- seuils anti-réidentification ;
- qualité suffisante ;
- mécanisme d'opt-out/consentement si requis.

## AI Gateway

Toute inference probabiliste passe par `46_AI_GATEWAY_AND_MODEL_GOVERNANCE.md`.

## Release gate

Voir `48_AI_SECURITY_AND_EVALUATION.md`. Une feature IA non évaluée n'est pas une feature production.
