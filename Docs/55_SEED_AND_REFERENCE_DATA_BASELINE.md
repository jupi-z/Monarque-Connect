# 55 — Baseline des seeds et données de référence

## Objectif

Définir les données de référence nécessaires aux parcours Identity/Tenancy et Product Entitlements, sans enfermer les valeurs métier dans des enums PostgreSQL fermés lorsque leur évolution est attendue.

## Principes

- les seeds sont idempotents et rejouables sur une base vide ou existante ;
- chaque ligne de référence possède une clé stable et une sémantique documentée ;
- les données tenant sont séparées des données de plateforme ;
- les seeds ne contiennent aucun secret, compte utilisateur réel ou donnée personnelle ;
- les migrations créent le schéma, les seeds remplissent les références ;
- les changements de référence sont revus comme du code et testés en CI.

## Première tranche Phase 1

- types d'entreprise de base, extensibles par la plateforme ;
- rôles tenant et permissions/capabilities canoniques ;
- statuts d'organisation et d'établissement ;
- scopes d'établissement ;
- valeurs de classification et statuts nécessaires aux contrats API.

## Première tranche Phase 2

- catalogue des modules ;
- presets de business types ;
- plans et versions de plans ;
- règles d'entitlements et dépendances de modules.

Chaque ajout doit préciser propriétaire, clé stable, description, état actif et stratégie de compatibilité.
