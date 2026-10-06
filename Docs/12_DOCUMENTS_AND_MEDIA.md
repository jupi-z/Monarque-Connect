# 12 — Documents, médias et pièces de conformité

## Objectif

Le module Documents gère les pièces attachées aux opérations et les documents critiques d'une entreprise sans transformer le stockage objet en simple disque partagé non gouverné.

## Stockage

- binaires dans stockage S3-compatible ;
- DB = métadonnées uniquement ;
- upload par URL présignée ;
- clé objet générée côté serveur ;
- confirmation après vérification metadata ;
- taille/MIME allowlist ;
- téléchargement privé par URL présignée courte ;
- aucun bucket public pour documents privés.

## Document métier

Un `Document` possède au minimum :
- organization ;
- establishment optionnel ;
- catégorie/type ;
- titre ;
- MediaObject ;
- visibilité ;
- date d'émission optionnelle ;
- date d'expiration optionnelle ;
- issuer/reference optionnels ;
- liens métier typés ;
- auteur/timestamps.

## Pièces critiques et conformité documentaire

Le MVP doit pouvoir suivre :
- pièces légales de l'entreprise ;
- contrats ;
- certifications ;
- pièces fournisseur/client ;
- justificatifs de dépenses ;
- pièces associées à RFQ/PO/Receipt ;
- documents projet.

Les catégories exactes restent configurables ; le backend ne doit pas présenter une pièce comme légalement obligatoire sans spécification locale validée.

## Expiration et alertes

Un document avec `expires_at` peut alimenter Monarque Intelligence :
- expiration proche ;
- expiré ;
- renouvellement requis selon règle configurée.

L'alerte ne constitue pas une certification juridique automatique.

## Publication réseau

Un document privé n'est jamais exposé directement via Monarque Network.

Une organisation peut publier un `PublishedCredential` qui référence éventuellement un document interne, mais le réseau n'expose que les métadonnées explicitement allowlistées. La pièce source reste privée sauf fonctionnalité future distincte.

## Permissions

Les pièces héritent du tenant et, lorsque pertinent, de l'establishment et de la ressource métier liée.

Les pièces financières suivent les permissions de la ressource financière. Un utilisateur ne gagne pas accès à une facture privée simplement parce qu'il connaît l'identifiant du document.

## Sécurité et cycle de vie

- antivirus/malware scanning ajoutable via événement durable ;
- hash/metadata pour détecter corruption lorsque utile ;
- suppression physique différée uniquement quand rétention et références le permettent ;
- export de données inclut les métadonnées et, selon le type d'export, les fichiers autorisés ;
- toute publication/dépublication de credential sensible est auditée.
