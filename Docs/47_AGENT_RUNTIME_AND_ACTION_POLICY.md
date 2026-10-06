# 47 — Agent Runtime et politique d'action

## Position

Les agents sont une extension future de Monarque Intelligence. L'architecture est préparée dès maintenant afin d'éviter un accès privilégié non gouverné plus tard.

## Identité d'un agent

Un agent possède :
- `agentDefinitionId` ;
- version ;
- organizationId ;
- actor type `AGENT` ;
- initiatingUserId ;
- delegated permissions ;
- establishment scopes ;
- correlationId ;
- expiration de délégation.

L'agent ne devient jamais OWNER/PLATFORM_ADMIN par lui-même.

## Accès

Un agent utilise uniquement :
- queries autorisées ;
- commands/tools typés ;
- APIs internes/publiques contrôlées.

Interdits :
- SQL direct ;
- accès secrets ;
- shell arbitraire de production ;
- appels réseau non allowlistés ;
- escalade de rôle ;
- modification de ses propres permissions.

## Classes d'action

### A0 — Read/Explain
Lecture et explication. Peut être automatique dans le scope autorisé.

### A1 — Draft
Créer un brouillon sans effet externe :
- devis draft ;
- RFQ draft ;
- message draft ;
- proposition de réapprovisionnement.

Peut être automatique selon feature.

### A2 — Reversible operational action
Action mutante mais réversible/contrôlée. Confirmation utilisateur par défaut.

### A3 — High-impact
Toujours confirmation explicite et revalidation serveur :
- émettre/annuler facture ;
- enregistrer paiement ;
- mouvement de caisse ;
- confirmer réception/stock ;
- modifier membership/role ;
- modifier plan/entitlement ;
- publier une donnée sensible ;
- envoyer une communication externe engageante.

### A4 — Prohibited autonomous
Jamais autonome :
- modifier auth/security policy ;
- exporter secrets ;
- changer audit logs ;
- supprimer durablement un tenant ;
- contourner conformité ou approbations ;
- prendre une décision juridique/comptable définitive.

## Action proposal

Avant action A2/A3, l'agent produit une proposition structurée :
- intention ;
- tool ;
- arguments ;
- impact ;
- sources/provenance ;
- risques ;
- confirmationRequired.

Après confirmation, le serveur revalide permissions, entitlements et état courant. Une confirmation ancienne ne vaut pas autorisation permanente.

## Idempotence

Chaque tool mutation reçoit une clé d'idempotence. Retry modèle/réseau ne doit jamais dupliquer paiement, message ou mouvement.

## Audit

Conserver :
- initiateur humain ;
- agent/version ;
- modèle/run si applicable ;
- proposition ;
- confirmation ;
- tool exécuté ;
- résultat ;
- request/correlation IDs.
