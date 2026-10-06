# 41 — Portabilité, export et réversibilité des données

## Principe

La rétention de Monarque Connect doit venir de la valeur du produit, du réseau et de l'historique opérationnel, pas de l'impossibilité pour une entreprise de récupérer ses données.

La portabilité de base est une capacité core et ne doit pas être réservée à un plan premium.

## Export MVP

OWNER et ADMIN autorisés peuvent demander un export tenant.

L'export principal couvre, selon permissions et politique :
- organisation et établissements ;
- membres hors secrets d'authentification ;
- parties ;
- catalogue ;
- CRM ;
- ventes ;
- achats ;
- paiements constatés ;
- dépenses/caisse ;
- stock ;
- projets ;
- métadonnées documents ;
- relations réseau propres au tenant ;
- audit exportable selon politique.

## Formats

- données structurées : JSON et/ou CSV documentés ;
- manifest versionné ;
- fichiers binaires : archive séparée ou package associé lorsque demandé et autorisé.

Le format doit être exploitable sans logiciel propriétaire Monarque Connect.

## Traitement

Les exports volumineux sont asynchrones :
`REQUESTED → PROCESSING → READY | FAILED | EXPIRED`.

- idempotence sur la création ;
- object storage privé ;
- URL de téléchargement courte ;
- expiration automatique ;
- audit de la demande et du téléchargement lorsque disponible ;
- aucun secret, hash password, refresh token ou clé interne dans l'export.

## Isolation

Un export est construit exclusivement dans le contexte du tenant demandé. Les données réseau d'un partenaire ne sont incluses que si elles font partie de la copie légitime détenue par le tenant.

## Fermeture future

La suppression/clôture définitive d'un tenant exige une politique de rétention, sauvegarde et obligations contractuelles/légales validée. Le MVP ne promet pas d'effacement immédiat irréversible.

## Critère avant lancement commercial

Un export des données principales doit être généré et relu dans un environnement de test avant release MVP.
