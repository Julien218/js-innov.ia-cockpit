# Architecture du Cockpit JS-Innov.IA

## Objectif

Centraliser les fonctions communes des produits JS-Innov.IA sans dupliquer les secrets, la logique d’authentification, l’envoi d’emails, la journalisation et les contrôles métier.

## Composants

### Frontend

- React 18 et Vite ;
- React Router pour les parcours ;
- TanStack Query pour les données ;
- composants Radix UI ;
- accès exclusivement same-origin aux routes sensibles.

### API Cockpit

`server.cjs` monte les modules suivants :

- `server-auth.cjs` : authentification et sessions ;
- `server-security.cjs` : rôles, sessions et contrôle d’origine ;
- `server-email.cjs` : IMAP, SMTP et proxy officiel HainoFlow ;
- `server-billing.cjs` : PDF et envoi des devis/factures ;
- `server-assistant.cjs` : assistant personnel et actions confirmées ;
- proxy `/api/data` vers `jsinnovia-agent`.

### Données

Supabase gère les utilisateurs, sessions et données métier. Les clés privilégiées restent exclusivement côté serveur.

### Email

Le Cockpit détient les identifiants IONOS. Les services externes utilisent une clé dédiée et l’endpoint `/api/emails/official`. L’expéditeur est fixé côté serveur afin d’empêcher l’usurpation.

## Frontières de sécurité

1. Les variables `VITE_*` sont publiques.
2. Les clés Supabase privilégiées, SMTP, OpenAI, agent et email proxy sont serveur uniquement.
3. Les routes frontend sont protégées pour l’expérience utilisateur, mais l’autorisation réelle est contrôlée côté serveur.
4. Les écritures same-origin sont vérifiées.
5. HainoFlow ne contourne la session admin que pour le chemin exact `/api/emails/official`, qui exige `EMAIL_PROXY_KEY`.

## Rôles

| Rôle | Niveau | Usage |
|---|---:|---|
| client | 1 | accès à ses projets, devis, factures et demandes autorisées |
| collaborateur | 2 | opérations CRM et assistant |
| admin | 3 | finance, emails, paramètres et administration |
| superadmin | 4 | contrôle complet et opérations sensibles |

## Risques techniques ouverts

- idempotence email conservée en mémoire locale ;
- rate limits de certains modules conservés en mémoire locale ;
- dépendance historique à Base44 dans plusieurs pages ;
- coexistence de deux noms de secret Supabase pendant la migration ;
- documentation et tests fonctionnels de certaines pages encore incomplets ;
- absence de dépôt HainoFlow identifiable dans les dépôts GitHub accessibles.

## Architecture cible

- persistance PostgreSQL ou Redis pour idempotence, queue et rate limiting ;
- journal d’email central avec statuts et retries ;
- contrats API versionnés ;
- clés dédiées par application consommatrice ;
- observabilité centralisée ;
- tests d’intégration et end-to-end obligatoires avant fusion ;
- documentation d’exploitation et de restauration.

## Règle de déploiement

Aucune fusion ou mise en production ne doit être considérée comme validée sans :

- CI verte ;
- contrôle des migrations ;
- confirmation des variables ;
- test post-déploiement ;
- autorisation explicite pour la production.
