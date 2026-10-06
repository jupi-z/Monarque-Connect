# 46 — AI Gateway et gouvernance des modèles

## Principe

Aucun module métier ne doit appeler directement un fournisseur IA.

Toutes les inférences passent par un **AI Gateway** propriétaire et provider-neutral.

## Responsabilités du Gateway

- résolution de policy tenant ;
- contrôle de classification ;
- minimisation/redaction ;
- sélection fournisseur/modèle ;
- timeout/retry/circuit breaker ;
- budget/token limits ;
- request metadata ;
- structured output validation ;
- observabilité ;
- audit approprié ;
- policy de rétention fournisseur.

## Adapter fournisseur

Interface conceptuelle :
- `generateStructured()`
- `generateText()`
- `embed()` futur
- `classify()` futur

Le domaine ne connaît ni OpenAI, ni Anthropic, ni Google, ni un modèle local.

## Model Registry

Chaque modèle autorisé est décrit par :
- provider ;
- modelId ;
- capability ;
- statut ;
- data classes autorisées ;
- régions/retention connues ;
- coût/limites ;
- date de validation ;
- version de policy.

## Structured outputs

Pour toute sortie utilisée par du code :
- schema explicite ;
- validation stricte ;
- rejection des champs inattendus ;
- jamais d'eval/exécution de texte généré.

## Données

- prompts système et secrets jamais mélangés avec contenu utilisateur non fiable ;
- données tenant non utilisées pour training par défaut ;
- logs de prompts/réponses bruts désactivés par défaut pour données sensibles ;
- metadata de run conservée selon politique.

## Résilience

Si le modèle/fournisseur est indisponible :
- le Core reste fonctionnel ;
- les fonctions IA retournent un état dégradé clair ;
- aucune transaction critique n'attend indéfiniment une inference.

## Coûts

Chaque run mesure :
- modèle ;
- tokens/units ;
- latence ;
- coût estimé si disponible ;
- tenant ;
- feature.

Les quotas IA futurs sont indépendants des quotas transactionnels.
