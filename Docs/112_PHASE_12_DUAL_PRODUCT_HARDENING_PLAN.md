# Phase 12 — Hardening / release à deux produits

**PLANNED.** Une seule infrastructure Core et deux offres indépendantes. Monarque Connect ne doit pas dépendre du fait que ZAMUREK soit activé pour continuer ses flux Business OS.

## Couverture obligatoire
- **Rétrocompatibilité** : ancien parcours quote→order→invoice→payment, achats, inventaire, cash, réseau et FairScale ; compatibilité des applications clients installées.
- **Omnicanal** : web/API acheteur ZAMUREK derrière Android embarqué, caisse connectée, cash, reçus et facture thermique/A4 ; restauration de sessions, retour/annulation, fin de journée, concurrence.
- **Tenancy** : shared DB, isolations org/establishment/actor/object à travers Core, produits et venue ; test BOLA/IDOR et RLS si retenu ; export/restauration sélective réelle.
- **Financial consistency** : pas de double payment/order/cash movement, FX snapshots, montants exacts en poids/quantité et devises, tickets et facture fiscale RDC selon droit réel.
- **AI** : policies/fail-close, fournisseurs indisponibles, injection/prompt exfiltration, coût, audits et opérateurs.
- **Operational** : migration empty+upgrade depuis 10A, runbooks, backups chiffrés, restore, observabilité, audit conformité, rates/perf, CI Android/Windows + contract/API tests, scans licences transitive/SBOM.
- **Release gates séparés** : (i) Core techniquement stable, (ii) Monarque Connect commercialement autorisé, (iii) ZAMUREK V1 complète commercialement autorisée ; la fermeture d'un gate n'impute pas le succès des deux autres.
- **Pharmacies** : uniquement articles non réglementés autorisés par défaut, médicaments bloqués hors validation professionnelle légale ; interdiction de conseils médicaux par IA.
- LaJoie Mall : **partenariat non conclu**, aucune publication de marque/accord fictif ; tests seulement venues synthétiques.

## Clôture
P0/P1 pass sur tests réels, CI, build, environnement, legal releases et rapports horodatés. Les gates externes FairScale 9.6 restent ouverts sans preuve ; ne jamais forcer leur clôture depuis la Phase 12.
