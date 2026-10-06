# 31 — Checklist de bootstrap

Avant toute implémentation de Phase 0.5 ou feature métier :

- [x] dépôt privé créé ;
- [x] `@Gabby344` a accepté l'invitation collaborateur ;
- [ ] protection `main` configurée ;
- [x] `npm install` exécuté avec Node 24 ;
- [x] `package-lock.json` commité ;
- [x] `npm run lint` vert ;
- [x] `npm run typecheck` vert ;
- [x] `npm test` vert ;
- [x] `npm run build` vert ;
- [ ] configuration fail-fast validée en CI ;
- [ ] `npm run prisma:generate` vert ;
- [ ] readiness vérifie réellement PostgreSQL ;
- [x] PostgreSQL 17 démarre via conteneur Docker en CI ;
- [x] health live/ready répondent par HTTP en CI ;
- [x] OpenAPI validée ;
- [x] première PR de fondation fusionnée.

La Phase 0.5 et les verticales métier ne commencent pas tant que cette checklist n'est pas entièrement verte.
