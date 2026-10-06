# 09 — Isolation multi-tenant

C'est l'invariant de sécurité prioritaire du produit.

## Règle
Tout use-case tenant commence par résoudre :
`authenticated user → active membership → organization → permission`.

## Interdictions
- aucun repository métier générique sans scope tenant ;
- aucun lookup `findById(id)` d'une entité tenantée sans `organizationId` ;
- aucun `organizationId` du body utilisé comme preuve d'autorité ;
- aucune jointure cross-tenant sauf feature réseau explicitement prévue ;
- aucune donnée privée tenant dans les logs.

## Tests obligatoires
Pour chaque ressource tenantée :
1. accès légitime A → succès ;
2. utilisateur B autre tenant → `404` ou `403` selon politique ;
3. ID valide d'un autre tenant → aucune fuite ;
4. rôle insuffisant → refus ;
5. membership suspendu → refus.

## Défense en profondeur
Le MVP impose l'isolation applicative + contraintes DB. PostgreSQL RLS pourra être ajouté par ADR lorsque son intégration transactionnelle avec Prisma sera entièrement maîtrisée.
