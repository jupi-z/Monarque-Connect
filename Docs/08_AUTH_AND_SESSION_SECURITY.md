# 08 — Authentification et sessions

- password : Argon2id ;
- access token : JWT signé asymétriquement, TTL court (~15 min) ;
- refresh token : opaque 256 bits min, hashé en DB, TTL long ;
- rotation à chaque refresh ;
- replay d'un ancien refresh : révocation de famille ;
- claims minimaux : `sub`, `sid`, `jti`, `iss`, `aud`, `iat`, `exp`, `kid` ;
- rôles tenant non considérés comme immuables dans le token : autorisation vérifiée avec état courant ou stratégie de cache sûre ;
- suspension user invalide les refresh et bloque les access tokens au prochain appel ;
- login rate-limited ;
- messages d'erreur sans oracle utilisateur ;
- invitations à token opaque hashé, usage unique, expiration ;
- changement password révoque toutes les autres sessions ;
- secrets de signature hors Git avec rotation par `kid`.
