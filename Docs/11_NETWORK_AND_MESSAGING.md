# 11 — Réseau B2B et messagerie

## 1. Profil public

Une organisation choisit explicitement si son profil est public. Seuls les champs allowlistés du `OrganizationProfile` sont exposés.

Le type d'entreprise et les catégories publiques servent à la découverte ; ils n'exposent aucune donnée opérationnelle privée.

## 2. Vérification et confiance

Le MVP restaure la dimension de confiance du concept initial sans introduire de notation opaque.

Le profil peut afficher :
- statut de vérification Monarque Connect ;
- date/expiration de vérification si pertinente ;
- certifications/références que l'entreprise choisit de publier ;
- complétude de profil non sensible.

Ne font pas partie du MVP :
- étoiles/avis publics ;
- score réputationnel propriétaire opaque ;
- classement automatique d'entreprises ;
- publication de pièces justificatives sensibles.

La vérification est gérée par le Control Plane et auditée.

## 3. Découverte

Le réseau permet la recherche d'organisations par :
- nom ;
- catégorie/type métier public ;
- localisation publique ;
- produits/services publics ;
- statut de vérification si cette capacité est activée.

Le moteur de recherche dédié reste différé ; PostgreSQL suffit au MVP.

## 4. Connexion

`PENDING → ACCEPTED | DECLINED | CANCELLED`.

Pas d'auto-connexion à soi-même. Une paire acceptée est unique.

## 5. Network Inquiry

Une organisation authentifiée peut envoyer une demande commerciale à une autre organisation visible si ses règles de contact le permettent.

`NEW → QUALIFIED | DISMISSED | CONVERTED`.

Le destinataire peut convertir l'inquiry en Lead/Opportunity sans recopier manuellement le contexte.

Cette liaison matérialise la boucle :
`Network → CRM → Sales → historique opérationnel`.

## 6. Sourcing / RFQ réseau

Le module `PURCHASES` peut envoyer une SupplierRFQ à :
- un fournisseur interne au tenant ;
- une organisation connectée du réseau.

Le fournisseur réseau ne voit que la RFQ qui lui est adressée et les données explicitement partagées. Aucun accès au back-office de l'acheteur n'est créé.

## 7. Linking BusinessParty

Une organisation peut lier un `BusinessParty` local à une organization du réseau. Ce lien sert à éviter les doublons et à fluidifier les transactions, sans fusion de données privées.

## 8. Messagerie

Une conversation B2B n'est créée que si la policy réseau l'autorise.

Messages :
- texte MVP ;
- immuables ;
- auteur + organisation d'origine ;
- retry-safe via `clientMessageId` ;
- pagination curseur.

Aucun utilisateur d'une entreprise ne peut lire les conversations d'une entreprise dont il n'est pas membre.

## 9. Anti-abus MVP

- rate limiting des inquiries/messages ;
- blocage organisation↔organisation possible ;
- audit des actions sensibles ;
- statut de connexion vérifié côté serveur ;
- pas d'envoi de masse non sollicité dans le MVP.

## 10. Entitlements

- visibilité réseau : `NETWORK_PROFILE` ;
- confiance/vérification : `NETWORK_TRUST` ;
- découverte : `NETWORK_DISCOVERY` ;
- inquiry : `NETWORK_INQUIRIES` ;
- connexions : `NETWORK_CONNECTIONS` ;
- messagerie : `MESSAGING`.

Les plans/presets peuvent activer des combinaisons différentes, mais le backend reste la source de vérité.
