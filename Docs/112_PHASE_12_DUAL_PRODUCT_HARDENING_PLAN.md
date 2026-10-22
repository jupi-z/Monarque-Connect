# Phase 12 — Hardening / release à deux produits

**PLANNED.** Une seule infrastructure Core et deux offres indépendantes. Monarque Connect ne doit pas dépendre du fait que ZAMUREK soit activé pour continuer ses flux Business OS. **Invariants de compatibilité et de disponibilité** : [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md) B-00–B-09.

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

**Gates de release séparés et vérifiables** : `CORE_TECHNICAL_ACCEPTED` après CI+tests de charge/soak, sécurité, migrations et restore ; `MONARQUE_CONNECT_COMMERCIAL_GO` seulement après ses preuves opérationnelles et FairScale #123 ; `ZAMUREK_COMMERCIAL_GO` seulement après contrats clients, POS sur matériel réel, stockage documentaire de production, juridique/fiscalité et payment provider si applicable. Fournisseur IA hors service n'arrête pas les ventes. Une preuve de simulation ne peut pas être comptée comme homologation.

P0/P1 pass sur tests réels, CI, build, environnement, legal releases et rapports horodatés. Les gates externes FairScale 9.6 restent ouverts sans preuve ; ne jamais forcer leur clôture depuis la Phase 12.
