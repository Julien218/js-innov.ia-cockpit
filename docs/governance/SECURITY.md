# Politique & Mesures de Sécurité Techniques — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit
**Domaine :** `cockpit.jsinnovia.com`
**Statut :** Recommandations techniques & mesures applicables
**Version :** 1.0.0
**Date :** 13 août 2026

---

## 1. Principes Directeurs de Sécurité

La sécurité du Cockpit JS-Innov.IA repose sur le principe de **défense en profondeur** (*Defense in Depth*) et d'architecture **Zero Trust**. Chaque couche applicative valide et authentifie les requêtes indépendamment.

---

## 2. Piliers de la Sécurité Applicative

### 2.1 Zéro Secret dans le Frontend Client
- **Règle Stricte :** Aucune clé d'administration, clé `service_role`, secret OAuth, mot de passe de messagerie ou jeton maître ne doit être inclus dans le bundle frontend Vite/React.
- **Convention de Nommage :**
  - Les variables préfixées par `VITE_` sont publiques et incluses dans le code client livré au navigateur. Elles ne doivent contenir que des URLs publiques ou des clés publiques anonymes (`ANON_KEY`).
  - Toutes les autres variables d'environnement sont **strictement réservées au serveur** Node.js sur Railway.

### 2.2 Authentification & Gestion de Session par Cookies HttpOnly
- Les tokens d'authentification et de session ne sont pas stockés dans le `localStorage` ou le `sessionStorage` du navigateur (vulnérables aux attaques XSS).
- Les sessions sont maintenues via des cookies sécurisés configurés avec les attributs suivants :
  - `HttpOnly` : Empêche l'accès au cookie via des scripts JavaScript client.
  - `Secure` : Exige que le cookie ne soit transmis que sur des liaisons HTTPS chiffrées.
  - `SameSite=Strict` : Protège contre les attaques par falsification de requête intersites (CSRF).

### 2.3 Clé `service_role` Strictement Confinée au Serveur
- La clé Supabase `SERVICE_ROLE_KEY` (qui outrepasserait le RLS si elle était divulguée) est uniquement déclarée dans l'environnement du backend Node.js (`server.cjs`, `server-security.cjs`).
- Le backend valide les habilitations du rôle utilisateur (`superadmin`, `admin`, `collaborateur`, `client`) et vérifie le périmètre `organisation_id` avant d'émettre des requêtes privilégiées vers Supabase.

### 2.4 Row Level Security (RLS) sur la Base de Données
- Le schéma `governance` et les tables sensibles de Supabase activent le Row Level Security.
- Politique par défaut : **Verrouillage total par défaut (Deny All)**. Seul le rôle serveur identifié `service_role` dispose des droits d'accès définis.

### 2.5 Rate Limiting & Protection Contre le Déni de Service (DoS)
- Le serveur intègre des limites de débit de requêtes (*Rate Limiting*) sur les endpoints sensibles (`/api/auth/*`, `/api/email/*`, `/api/ai-cost/*`) afin de prévenir les attaques par force brute ou épuisement de ressources.
- Exemple de configuration :
  - Authentification : max 10 tentatives par fenêtre de 15 minutes par IP.
  - API Générale : max 300 requêtes par minute par utilisateur authentifié.

### 2.6 Validation d'Origine & Contrôle CORS
- Les en-têtes CORS (*Cross-Origin Resource Sharing*) sont strictement restreints aux origines autorisées (`https://cockpit.jsinnovia.com`).
- Rejet explicite des requêtes dont l'en-tête `Origin` ou `Referer` ne correspond pas aux domaines de confiance enregistrés.

---

## 3. Gestion des Clés & Analyse des Secrets (*Secret Scan*)

### 3.1 Rotation des Clés & Certificats
- **Clés API Tiers (OpenAI, xAI, Stripe, Agent) :** Plan de rotation semestriel ou immédiat en cas de suspicion de fuite.
- **Tokens OAuth Dropbox :** Utilisation exclusive du mécanisme de *Refresh Token* à longue durée d'action, évitant l'usage de jetons d'accès statiques à durée illimitée.

### 3.2 Secret Scanning & Sécurité Git
- Intégration de hooks pre-commit localement et du scanner de secrets GitHub (*GitHub Secret Scanning / TruffleHog / GitGuardian*) sur le dépôt de code.
- Interdiction de commiter tout fichier `.env`, `.env.local` ou clé d'API privée. Le fichier `.env.example` sert de référence unique pour la structure des variables.

---

## 4. Politique de Traitement des Incidents de Sécurité

1. **Détection & Alerte :** Toute anomalie de sécurité (ex: multiples échecs d'authentification, tentative d'accès cross-tenant) génère un événement `critical` ou `error` dans `governance.audit_log`.
2. **Confinement Immédiat :** Révocation instantanée du token de session concerné ou rotation de la clé compromis.
3. **Notification de Violation de Données (RGPD Art. 33/34) :**
   - En cas d'incident entraînant une violation de données à caractère personnel, notification à l'autorité de contrôle (CNIL / APD) dans un délai maximal de **72 heures**.
   - Notification aux personnes concernées si la violation présente un risque élevé pour leurs droits et libertés.

---

## 5. Avertissement Légal

> **STATUT : A VALIDER JURIDIQUEMENT & TECHNIQUEMENT**
> Les mesures de sécurité décrites doivent faire l'objet de tests de pénétration (*pentest*) et de revues de code régulières pour s'assurer de leur efficacité constante face aux nouvelles vulnérabilités.
