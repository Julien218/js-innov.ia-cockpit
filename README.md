# JS-Innov.IA Cockpit

Cockpit central de pilotage de l’écosystème JS-Innov.IA. L’application regroupe le CRM, les projets, la facturation, les emails, les automatisations, les agents IA, la production de contenu et l’administration des services.

## Fonctionnalités présentes

- tableau de bord avec chiffre d’affaires, commissions, clients, leads, projets et tâches ;
- CRM clients, leads et demandes ;
- gestion des projets et tâches ;
- devis et factures avec génération PDF et envoi ;
- commissions, validations et journaux ;
- assistant personnel sécurisé ;
- registre et gestion des agents IA ;
- emails IMAP/SMTP multi-boîtes ;
- route serveur-à-serveur `POST /api/emails/official` pour HainoFlow et les applications autorisées ;
- studio vidéo, miniatures, exports, templates et calendrier ;
- portfolio, automatisations, domaines et rangement ;
- rôles `client`, `collaborateur`, `admin` et `superadmin`.

Les routes principales sont déclarées dans `src/App.jsx`. Le serveur Express est lancé par `server.cjs` et nginx sert le frontend dans le conteneur Railway.

## Architecture

```text
Navigateur
   │ cookie HttpOnly
   ▼
Cockpit React/Vite
   │ same-origin /api/*
   ▼
Express Cockpit
   ├── Auth Supabase
   ├── Proxy jsinnovia-agent
   ├── Assistant personnel
   ├── Facturation PDF
   └── Email IONOS
          ▲
          │ EMAIL_PROXY_KEY + Idempotency-Key
       HainoFlow / services autorisés
```

Le Cockpit est le seul détenteur des identifiants SMTP. HainoFlow ne reçoit jamais les mots de passe des boîtes email.

## Prérequis

- Node.js 24 ;
- npm ;
- accès à un projet Supabase ;
- accès au service `jsinnovia-agent` ;
- boîtes IONOS configurées pour les fonctions email.

## Installation locale

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Le serveur API peut être lancé séparément :

```bash
npm start
```

## Qualité et tests

```bash
npm run lint
npm run typecheck
npm test
npm run build
node --check server.cjs
node --check server-auth.cjs
node --check server-security.cjs
node --check server-email.cjs
node --check server-billing.cjs
node --check server-assistant.cjs
```

La CI complète est définie dans `.github/workflows/cockpit-quality.yml`. Les tests spécifiques au proxy email restent dans `.github/workflows/official-email-ci.yml`.

## Configuration

Copier `.env.example` et renseigner uniquement les variables nécessaires. Aucun secret ne doit être préfixé par `VITE_`, car ces variables sont intégrées au bundle navigateur.

Variables serveur essentielles :

```text
SUPABASE_URL
SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY
COCKPIT_URL
JSINNOVIA_AGENT_URL
JSINNOVIA_AGENT_KEY
AGENT_API_KEY
EMAIL_PROXY_KEY
```

Variables SMTP selon les boîtes activées :

```text
EMAIL_JSINNOVIA_ADDRESS
EMAIL_PASSWORD
EMAIL_ASSURANCES_ADDRESS
EMAIL_PASSWORD_ASSURANCES
EMAIL_STORE_ADDRESS
EMAIL_PASSWORD_STORE
```

`EMAIL_PROXY_KEY` doit être aléatoire, distincte de `AGENT_API_KEY` et stockée uniquement dans les variables serveur.

## Intégration HainoFlow

HainoFlow appelle :

```text
POST https://cockpit.jsinnovia.com/api/emails/official
```

En-têtes obligatoires :

```text
Content-Type: application/json
x-agent-key: <EMAIL_PROXY_KEY>
Idempotency-Key: <identifiant unique de 8 à 128 caractères>
```

Exemple de payload :

```json
{
  "to": ["recipient@example.com"],
  "subject": "Objet",
  "text": "Contenu texte",
  "metadata": {
    "source": "hainoflow"
  }
}
```

Le champ `from` est volontairement refusé : l’expéditeur officiel est fixé côté serveur.

## Déploiement Railway

Le déploiement de production suit la branche `main`. Avant fusion :

1. vérifier la CI ;
2. vérifier les variables Railway sans afficher leurs valeurs ;
3. valider les migrations éventuelles ;
4. fusionner uniquement après autorisation ;
5. contrôler `/api/health` et les parcours critiques après déploiement.

## Sécurité

- sessions par cookie HttpOnly, Secure et SameSite ;
- permissions vérifiées côté serveur ;
- protection same-origin des écritures ;
- clés serveur absentes du frontend ;
- validation stricte et limitation de débit sur l’email officiel ;
- idempotence obligatoire pour les envois HainoFlow ;
- journalisation des actions de l’assistant.

Limites actuellement identifiées : l’idempotence et certaines limitations de débit utilisent encore une mémoire locale. Une persistance PostgreSQL ou Redis est requise avant un déploiement multi-instance.

## Documentation

- `docs/ARCHITECTURE.md` — architecture et frontières de sécurité ;
- `docs/HAINOFLOW_EMAIL.md` — contrat d’intégration du proxy email ;
- `.env.example` — variables sans valeurs secrètes.

## Statut

Le proxy email officiel est validé en production sur une instance unique. Le produit complet reste en phase de consolidation : la CI globale, la documentation, la persistance des files et l’audit fonctionnel de chaque page doivent être finalisés avant de déclarer le Cockpit entièrement terminé.
