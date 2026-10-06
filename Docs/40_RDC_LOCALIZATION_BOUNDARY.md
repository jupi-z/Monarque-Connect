# 40 — Localisation RDC : périmètre et frontière de conformité

## Objectif

Monarque Connect doit être naturellement utilisable par les entreprises congolaises sans revendiquer une conformité juridique, fiscale, comptable ou sociale qui n'a pas été formellement validée.

## Capacités MVP sûres

### Identité d'entreprise
Le modèle doit accepter des identifiants d'enregistrement extensibles via type + valeur, au lieu de figer en code une liste supposée exhaustive.

Exemples de types configurables peuvent être ajoutés après validation fonctionnelle. Le backend ne déduit pas automatiquement la validité juridique d'un identifiant.

### Adresses
Adresses structurées avec pays, province/région, ville/localité et texte complémentaire.

### Devises
- devise par défaut de l'organisation ;
- devise explicite sur chaque document monétaire ;
- ISO 4217 ;
- prise en charge naturelle de USD et CDF ;
- aucune comptabilité de change réglementaire implicite dans le MVP.

### Documents commerciaux
Le moteur doit permettre des templates/localisations futures pour :
- devis ;
- bon de commande ;
- bon de livraison/réception ;
- facture ;
- reçu ;
- avoir futur.

Les mentions obligatoires ne sont pas inventées par le code avant validation locale.

## Fonctions non déclarées conformes au lancement

- comptabilité statutaire OHADA complète ;
- fiscalité automatisée ;
- paie et déclarations ;
- retenues/cotisations ;
- facturation réglementée spécifique ;
- signature/contrat électronique avec promesse de valeur probante.

Ces domaines exigent spécifications validées, scénarios de test et revue de professionnels compétents avant activation comme fonctions de conformité.

## Architecture

La localisation doit être ajoutée par :
1. données de référence ;
2. configuration ;
3. règles versionnées ;
4. modules dédiés si nécessaire.

Elle ne doit pas contaminer le core avec des conditions pays dispersées.

## Multi-pays futur

Le modèle de données de base reste neutre pour permettre une extension hors RDC. Les règles locales sont explicitement rattachées à une juridiction/version.

## Principe commercial

Monarque Connect peut être présenté comme adapté au contexte opérationnel congolais lorsque cette adaptation est réelle. Il ne doit pas promettre une conformité légale ou fiscale spécifique qui n'a pas été validée.
