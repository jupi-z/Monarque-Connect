# 48 — Sécurité IA et évaluation

## Menaces

- prompt injection directe/indirecte ;
- fuite cross-tenant ;
- exfiltration via tools ;
- hallucination ;
- confusion donnée/instruction ;
- model supply-chain/provider change ;
- training/retention non désirés ;
- tool argument manipulation ;
- action dupliquée après retry ;
- permissions obsolètes ;
- contenu malveillant dans documents/messages ;
- coûts non bornés ;
- dérive de qualité d'un modèle.

## Contrôles obligatoires avant feature IA production

### Sécurité
- retrieval pré-filtré par tenant/scope ;
- tool allowlist ;
- output schema validation ;
- secrets exclus ;
- classification/policy check ;
- confirmation des actions à risque ;
- rate/cost limits ;
- audit ;
- timeouts ;
- tests prompt injection.

### Qualité
Chaque feature dispose d'un jeu d'évaluation versionné :
- cas normaux ;
- cas limites ;
- données insuffisantes ;
- contradictions ;
- refus attendu ;
- exactitude factuelle ;
- respect des sources ;
- action correcte/non-action.

## Métriques

Selon feature :
- groundedness ;
- factual precision ;
- abstention correcte ;
- tool success rate ;
- false action rate ;
- latency ;
- cost/run ;
- user correction rate.

## Release gate

Une feature probabiliste n'est pas activée en production parce qu'elle “semble fonctionner”.

Elle nécessite :
1. objectif mesurable ;
2. dataset d'évaluation ;
3. seuils d'acceptation ;
4. threat model ;
5. privacy/data review ;
6. rollback/kill switch ;
7. monitoring.

## Model changes

Un changement de modèle majeur est traité comme changement de composant :
- réévaluation ;
- comparaison avec baseline ;
- validation sécurité ;
- canary lorsque pertinent.

## Incident

Kill switch tenant/global pour toute feature IA. Le Core transactionnel continue de fonctionner.
