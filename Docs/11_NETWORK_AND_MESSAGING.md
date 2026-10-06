# 11 — Réseau B2B et messagerie

## 1. Profil public

Une organisation choisit explicitement si son profil est public. Seuls les champs allowlistés du `OrganizationProfile` sont exposés.

Le type d'entreprise et les catégories publiques servent à la découverte ; ils n'exposent aucune donnée opérationnelle privée.

## 2. Découverte

Le réseau permet la recherche d'organisations par :
- nom ;
- catégorie/type métier public ;
- localisation publique ;
- produits/services publics ;
- statut de vérification si cette capacité est activée.

Le moteur de recherche dédié reste différé ; PostgreSQL suffit au MVP.

## 3. Connexion

`PENDING → ACCEPTED | DECLINED | CANCELLED`.

Pas d'auto-connexion à soi-même. Une paire acceptée est unique.

## 4. Network Inquiry

Une organisation authentifiée peut envoyer une demande commerciale à une autre organisation visible si ses règles de contact le permettent.

`NEW → QUALIFIED | DISMISSED | CONVERTED`.

Le destinataire peut convertir l'inquiry en Lead/Opportunity sans recopier manuellement le contexte.

Cette liaison matérialise la boucle :
`Network → CRM → Sales → historique opérationnel`.

## 5. Sourcing / RFQ réseau

Le module `PURCHASES` peut envoyer une SupplierRFQ à :
- un fournisseur interne au tenant ;
- une organisation connectée du réseau.

Le fournisseur réseau ne voit que la RFQ qui lui est adressée et les données explicitement partagées. Aucun accès au back-office de l'acheteur n'est créé.

## 6. Linking BusinessParty

Une organisation peut lier un `BusinessParty` local à une organization du réseau. Ce lien sert à éviter les doublons et à fluidifier les transactions, sans fusion de données privées.

## 7. Messagerie

Une conversation B2B n'est créée que si la policy réseau l'autorise.

Messages :
- texte MVP ;
- immuables ;
- auteur + organisation d'origine ;
- retry-safe via `clientMessageId` ;
- pagination curseur.

Aucun utilisateur d'une entreprise ne peut lire les conversations d'une entreprise dont il n'est pas membre.

## 8. Anti-abus MVP

- rate limiting des inquiries/messages ;
- blocage organisation↔organisation possible ;
- audit des actions sensibles ;
- statut de connexion vérifié côté serveur ;
- pas d'envoi de masse non sollicité dans le MVP.

## 9. Entitlements

- visibilité réseau : `NETWORK_PROFILE` ;
- découverte : `NETWORK_DISCOVERY` ;
- inquiry : `NETWORK_INQUIRIES` ;
- connexions : `NETWORK_CONNECTIONS` ;
- messagerie : `MESSAGING`.

Les plans/presets peuvent activer des combinaisons différentes, mais le backend reste la source de vérité.
