# 64 — Spécification d'exécution Phase 4 — CRM + Network entry

## Statut et autorité

Cette spécification ouvre la Phase 4 sur `main` après la clôture vérifiée de la
stabilisation cross-phase (`Docs/63_CROSS_PHASE_STABILIZATION_EVIDENCE.md`).
Elle définit le périmètre, les invariants, les contrats attendus et les gates
de livraison. Elle ne déclare aucun endpoint métier livré.

La Phase 4 est suivie par l'issue [#49](https://github.com/jupi-z/Monarque-Connect/issues/49).

## Objectif

Construire la première boucle métier reliant la relation B2B publique au CRM
tenant-scoped : une organisation peut publier une présence contrôlée, être
découverte selon des champs allowlistés, établir une connexion et recevoir une
`NetworkInquiry` convertible de manière idempotente en `Lead` ou `Opportunity`.

## Périmètre cible de la phase

### CRM

- `Lead` tenant-scoped, avec source, statut, party éventuelle et historique de
  qualification ;
- `Opportunity` tenant-scoped, établissement-scoped dès son entrée dans
  l'exécution commerciale, avec party, source et pipeline minimal ;
- transitions explicites, idempotentes et auditées ;
- conversion `NetworkInquiry → Lead | Opportunity` avec référence permanente à
  l'inquiry source ;
- aucun devis, commande, facture ou paiement : ils appartiennent à la Phase 5.

### Network entry

- profil public d'organisation opt-in, limité à une projection allowlistée ;
- statut de vérification et signaux de confiance publiables, gérés et audités
  par la plateforme ;
- découverte paginée sur nom, type/catégorie publique, localisation publique,
  produits/services publiés et statut de vérification lorsque disponible ;
- demandes de connexion et relation acceptée entre organisations ;
- `NetworkInquiry` authentifiée, soumise aux règles de contact, avec cycle
  `NEW → QUALIFIED | DISMISSED | CONVERTED`.

Les lectures publiques restent strictement read-only. Créer une connexion ou
une inquiry exige une identité authentifiée et une organisation source active.

## Hors périmètre

- messagerie et conversations : Phase 9 ;
- sourcing/RFQ réseau : Phase 6 ;
- ventes, devis et commandes : Phase 5 ;
- mouvements de stock : Phase 7 ;
- scoring réputationnel opaque, avis publics et classement automatique ;
- recherche full-text dédiée, import massif, IA, recommandations et
  automatisation d'envoi de masse ;
- partage implicite de données privées entre tenants.

## Invariants non négociables

1. Toute opération tenant suit l'ordre serveur canonique :
   `tenant actif → membership actif → entitlement → module actif → permission → scope établissement`.
2. Un `organizationId`, `establishmentId`, rôle ou code module fourni par le
   client ne constitue jamais une preuve d'autorité.
3. Les ressources privées restent tenant-scoped. Une relation Network ne donne
   accès qu'aux projections explicitement sérialisées pour cette relation.
4. Les profils publics sont opt-in et exposent uniquement une allowlist. Aucun
   contact privé, stock interne, prix privé, document privé ou entitlement
   interne ne peut être déduit d'une lecture publique.
5. Les modules contrôlés sont les codes canoniques existants :
   `CRM`, `NETWORK_PROFILE`, `NETWORK_TRUST`, `NETWORK_DISCOVERY`,
   `NETWORK_CONNECTIONS` et `NETWORK_INQUIRIES`. Le resolver Phase 2 reste la
   source de vérité ; aucun entitlement local ne sera créé dans le domaine.
6. Toute mutation significative écrit l'état, l'audit et l'événement Outbox dans
   la même transaction Prisma.
7. Toute transition métier est validée côté serveur, idempotente et sûre sous
   concurrence. Un retry ne crée ni doublon, ni second audit, ni second
   événement effectif.
8. Les identifiants d'idempotence et de corrélation sont propagés dans les
   commandes et événements. Les données publiques et privées conservent leur
   classification et leur provenance.
9. La conversion d'une inquiry est atomique et rejouable : une source ne peut
   produire qu'un seul résultat CRM effectif.
10. La plateforme garde la responsabilité de la vérification ; une organisation
    ne peut pas s'auto-attribuer un statut vérifié.

## Modèle et transitions attendus

| Agrégat | Cycle minimal | Scope | Autorité de mutation |
|---|---|---|---|
| `Lead` | `NEW → QUALIFIED → CONVERTED \\| DISMISSED` | organisation | membership + `CRM` + permission |
| `Opportunity` | `OPEN → WON \\| LOST \\| CANCELLED` | établissement après création opérationnelle | membership + `CRM` + permission + scope |
| `OrganizationProfile` | `PRIVATE ↔ PUBLIC` | organisation / projection publique | tenant admin + `NETWORK_PROFILE` |
| `ConnectionRequest` | `PENDING → ACCEPTED \\| DECLINED \\| CANCELLED` | paire d'organisations | membership + `NETWORK_CONNECTIONS` |
| `NetworkInquiry` | `NEW → QUALIFIED \\| DISMISSED \\| CONVERTED` | organisations explicitement concernées | membership + `NETWORK_INQUIRIES` |

Les transitions exactes, les permissions et les états finaux devront être
figés dans les contrats avant l'implémentation de chaque tranche.

## Autorisation et visibilité

Les services Phase 4 réutilisent les primitives existantes :
`AuthorizationService`, `EffectiveEntitlementsService`, les contrôles de scope
établissement et `PrismaOutboxWriter`. Aucun contrôleur ne doit contourner la
chaîne d'autorisation commune.

Les routes publiques sont limitées aux projections de profil, confiance et
découverte explicitement autorisées. Elles ne doivent pas révéler l'existence
d'un tenant privé par différence de statut ou par lookup non borné.

Les routes authentifiées de connexion et d'inquiry vérifient : organisation
source active, membership actif de l'acteur, capacités effectives des deux
côtés lorsque nécessaire, policy de contact et absence d'auto-ciblage.

## API-first et événements

Chaque tranche commence par les schémas OpenAPI détaillés : paramètres,
sécurité, réponses de succès et d'erreur, pagination, idempotence et exemples.
Les opérations placeholder existantes ne sont pas considérées comme contrats
livrés tant que ces éléments ne sont pas précisés et validés.

Événements minimaux à définir avant implémentation :

- `crm.lead.created`, `crm.lead.updated`, `crm.lead.status_changed` ;
- `crm.opportunity.created`, `crm.opportunity.updated`,
  `crm.opportunity.status_changed` ;
- `network.profile.published`, `network.profile.updated` ;
- `network.connection.requested`, `network.connection.status_changed` ;
- `network.inquiry.created`, `network.inquiry.status_changed`,
  `network.inquiry.converted`.

Les payloads doivent rester minimaux, classifiés, sans secrets ni projection
privée du tenant partenaire.

## Découpage d'exécution

1. **Contrats et modèle** : schéma, permissions, entitlements, états,
   projections publiques, idempotence, événements et migrations.
2. **CRM fondation** : leads, opportunities, party linkage, transitions et
   tests PostgreSQL tenant/scope/concurrence.
3. **Network profile/trust/discovery** : publication opt-in, allowlist,
   vérification plateforme, découverte paginée et refus de fuite.
4. **Connections/inquiries** : cycle de connexion, policy de contact,
   inquiry, conversion idempotente vers CRM.
5. **Preuves et clôture** : migrations base vide + upgrade Phase 3, E2E,
   OpenAPI, contrats, CI, documentation et tracker.

Une tranche peut être livrée par PR indépendante, mais aucune tranche ne peut
introduire un mécanisme d'autorisation local ou avancer silencieusement le
périmètre d'une phase suivante.

## Gate de sortie Phase 4

La phase ne pourra être déclarée terminée qu'après preuve effective de tous les
points suivants :

- modèle, états, permissions et entitlements validés ;
- migrations base vide et upgrade depuis la baseline Phase 3 ;
- isolation tenant et établissement, lectures publiques allowlistées et refus
  négatifs prouvés ;
- audit + Outbox transactionnels pour chaque mutation ;
- idempotence et concurrence prouvées pour transitions, connexions et
  conversion inquiry ;
- OpenAPI détaillé, contrats et exemples validés ;
- E2E et tests PostgreSQL verts ;
- CI GitHub verte sur PR et commit `main` fusionné ;
- preuves documentaires et issue #49 synchronisées ;
- branche de livraison supprimée après fusion.

## Décisions ouvertes à trancher avant le code

- permissions exactes par rôle pour lecture/écriture CRM et Network ;
- définition de la policy de contact et de la visibilité par défaut ;
- catégories/localisations publiques et stratégie d'indexation PostgreSQL ;
- niveau de détail du trust publiable et cycle d'expiration ;
- choix `Lead` ou `Opportunity` lors de la conversion, ou commande explicite ;
- quotas éventuels d'inquiries et de connexions, s'ils sont activés par le
  catalogue commercial.

Ces décisions seront consignées dans la tranche contrats avant toute migration
métier.
