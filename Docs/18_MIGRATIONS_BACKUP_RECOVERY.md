# 18 — Migrations, backup, recovery

- Prisma migrations versionnées ;
- `db push` interdit en production ;
- migration additive par défaut ;
- expand/migrate/contract pour breaking schema ;
- aucune suppression de colonne dans la même release qui cesse de l'écrire ;
- sauvegarde avant migration risquée ;
- restore test périodique ;
- base staging reconstruisible depuis migrations.

## Objectifs MVP
- RPO cible : 24 h maximum ;
- RTO cible : 4 h maximum ;
- preuve de restauration avant release commerciale.

Ces objectifs sont techniques internes, pas un SLA client.
