# 34 — Établissements et portée d'accès

## 1. Définition

Un `Establishment` est une unité opérationnelle appartenant à une seule organization :
- siège ;
- agence ;
- boutique ;
- bureau ;
- point de service ;
- autre unité commerciale.

Un warehouse est distinct d'un establishment et lui appartient.

## 2. Règle d'onboarding

Toute organization reçoit transactionnellement un établissement principal.

Ainsi, même une entreprise mono-site utilise le même modèle qu'une entreprise multi-agences. Cela évite une migration conceptuelle ultérieure.

## 3. Types

Valeurs initiales :
- `HEAD_OFFICE`
- `BRANCH`
- `SHOP`
- `OFFICE`
- `SERVICE_POINT`
- `OTHER`

Ces valeurs sont extensibles.

## 4. Ressources établissement-scopées

Obligatoires :
- warehouse ;
- stock movement ;
- quote ;
- sales order ;
- invoice ;
- payment record ;
- supplier RFQ ;
- purchase order ;
- goods receipt ;
- expense ;
- cash account/movement ;
- project.

Lead peut rester organization-wide pendant qualification ; Opportunity doit avoir un establishment lorsqu'elle devient opérationnelle.

## 5. Membership scopes

### ALL_ESTABLISHMENTS
Le membre peut agir dans tout établissement du tenant, dans la limite de son rôle.

### SELECTED_ESTABLISHMENTS
Le membre ne peut agir que dans les établissements explicitement liés.

Le scope s'applique aux lectures, écritures, exports, recherches et agrégations.

## 6. Sécurité

Une requête qui fournit un `establishmentId` :
1. vérifie que l'établissement appartient à l'organization du path ;
2. vérifie qu'il est actif si l'opération l'exige ;
3. vérifie le scope du membre ;
4. vérifie la permission du domaine.

Les recherches et compteurs doivent appliquer le scope avant pagination/agrégation afin d'éviter les fuites de métadonnées.

## 7. Multi-establishment

Les rapports organization-wide sont permis uniquement aux rôles/scopes autorisés.

Un utilisateur limité à deux établissements ne reçoit jamais un total consolidé incluant un troisième établissement.

## 8. Numérotation

La politique de numérotation peut être :
- organization-wide ;
- par établissement.

Elle est configurée par type de document et versionnée. Un changement n'altère jamais les numéros déjà émis.
