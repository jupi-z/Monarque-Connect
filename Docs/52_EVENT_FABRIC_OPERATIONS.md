# 52 — Exploitation de l'Event Fabric

## Pré-requis local

- Node.js 24 ;
- Docker Compose ;
- PostgreSQL 17 démarré par `docker compose -f docker-compose.dev.yml up -d` ;
- `DATABASE_URL` pointant vers cette base.

Initialiser ou mettre à niveau la base avec :

```bash
npm run prisma:deploy
```

La migration est additive. `prisma migrate reset` est réservé au développement local et détruit les données ; il ne doit jamais être utilisé sur une base partagée ou de production.

## Processus

Une commande qui produit un fait critique écrit l'état et `outbox_events` dans la même transaction. Le worker `npm run events:worker` réclame les lignes `PENDING` échues ou les leases expirés, traite hors verrou long, puis marque `PROCESSED`, reprogramme en `PENDING` ou termine en `FAILED`.

La livraison est **at-least-once**. Les consumers doivent enregistrer un receipt unique `(consumer_name,event_id)` dans la même transaction que leur projection/effect. Un replay est donc un no-op après le premier traitement.

Configuration opérationnelle initiale :

| Paramètre | Valeur |
|---|---:|
| batch size | 50 |
| poll interval | 1000 ms |
| lease | 60 s |
| max attempts | 8 |
| backoff | 1 s, 5 s, 30 s, 2 min, 5 min |

## Diagnostic

```sql
SELECT status, count(*) FROM outbox_events GROUP BY status ORDER BY status;

SELECT id, event_type, event_version, status, attempts, next_attempt_at,
       locked_at, locked_by, last_error_code, recorded_at
FROM outbox_events
WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')
ORDER BY recorded_at;
```

Ne pas logger ou copier `payload_json` par défaut. Les erreurs persistées sont bornées et nettoyées ; une intervention manuelle de reprise doit être auditée dans la verticale qui l'introduira.

Le worker expose des hooks d'observabilité sans payload brut : compteurs de succès/retry/échec, durée cumulée/maximale et résultats par type/version et consumer. Le runner écrit des événements JSON structurés contenant `eventId`, `eventType`, `eventVersion`, `correlationId`, `organizationId`, `attempt`, le résultat et la durée. Le repository fournit aussi les compteurs SQL `PENDING`, `PROCESSING`, `FAILED`, l'âge du plus ancien pending et les attempts moyen/maximal.

## Limites Phase 0.5

Le runner actuel ne fournit pas encore de console d'administration, de dead-letter UI, de backend Prometheus ou de rétention automatique. Les hooks et métriques SQL minimaux de la spécification sont présents. Aucun broker distribué, fournisseur IA, Knowledge Layer ou event sourcing n'est requis ni installé.

## Développement

Les tests d'intégration utilisent PostgreSQL réel et sont sérialisés par Vitest pour éviter que les fixtures se nettoient mutuellement. La gate complète est :

```bash
npm run prisma:deploy
npm run lint
npm run typecheck
npm run prisma:validate
npm run prisma:generate
npm run openapi:validate
npm run contracts:validate
npm test
npm run build
```
