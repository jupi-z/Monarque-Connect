# 11 — Réseau B2B et messagerie

## Profil public
Une organisation choisit explicitement si son profil est public. Seuls les champs allowlistés du `OrganizationProfile` sont exposés.

## Connexion
`PENDING → ACCEPTED | DECLINED | CANCELLED`.

Pas d'auto-connexion à soi-même. Une paire acceptée est unique.

## Linking business party
Une organisation peut lier un `BusinessParty` local à une organisation réseau. Le lien n'expose pas les données privées du partenaire.

## Messagerie
Une conversation B2B n'est créée que si les deux organisations ont une relation autorisée.

Messages :
- texte MVP ;
- immuables ;
- auteur + organisation d'origine ;
- retry-safe via `clientMessageId` ;
- pagination curseur.

Aucun utilisateur d'une entreprise ne peut lire les conversations d'une entreprise dont il n'est pas membre.
