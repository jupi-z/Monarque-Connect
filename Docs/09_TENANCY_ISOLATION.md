# 09 — Isolation multi-tenant et établissement

L'isolation est l'invariant de sécurité prioritaire du produit.

## Résolution de contexte

Tout use-case tenant commence par :

`authenticated user → active membership → organization → entitlement/module → role → establishment scope`.

## Interdictions

- aucun repository métier générique sans scope tenant ;
- aucun lookup `findById(id)` d'une entité tenantée sans contexte organization ;
- aucun `organizationId` du body utilisé comme preuve d'autorité ;
- aucun `establishmentId` utilisé sans vérifier organization + membership scope ;
- aucune jointure cross-tenant sauf feature Network explicitement prévue ;
- aucune donnée privée tenant dans les logs ;
- aucune agrégation exécutée avant application du tenant/scope.

## Ressources établissement-scopées

Pour les ventes, achats, caisse, stock, projets et dépenses, l'établissement fait partie du contexte de sécurité et pas uniquement d'un filtre UI.

## Tests obligatoires

Pour chaque ressource tenantée :
1. accès légitime tenant A → succès ;
2. utilisateur tenant B → refus sans fuite ;
3. ID valide d'un autre tenant → aucune révélation ;
4. rôle insuffisant → refus ;
5. membership suspendu → refus ;
6. entitlement absent → refus ;
7. module désactivé → refus fonctionnel approprié.

Pour chaque ressource établissement-scopée :
1. membre ALL → accès selon rôle ;
2. membre SELECTED contenant A → accès A ;
3. même membre → refus B ;
4. recherche/compteur/export → aucun élément B.

## Relations Network

Une relation `from_organization_id → to_organization_id` n'autorise que les données explicitement sérialisées pour la feature réseau concernée. Elle n'ouvre jamais l'accès au tenant partenaire.

## Défense en profondeur

Le MVP impose isolation applicative + contraintes DB. PostgreSQL RLS pourra être ajouté par ADR si son intégration avec Prisma et les transactions est suffisamment maîtrisée pour ne pas créer un faux sentiment de sécurité.
