# Email Core Framework — JS-Innov.IA Cockpit

> **Version :** 1.0.0  
> **Date :** août 2026  
> **Statut :** en développement (`branche agent/email-core-framework`)  
> **Auteur :** Équipe Core Platform & Infrastructure JS-Innov.IA  

---

## 📋 Description synthétique

Le **Email Core Framework** est le service centralisé, sécurisé et multi-marques d'envoi, de gestion et de suivi des courriers électroniques pour l'écosystème **JS-Innov.IA Cockpit**. 

Conçu comme une brique d'infrastructure réutilisable et pilotée par les données (*data-driven*), ce sous-système garantit :
- **Multi-marques natif :** Gestion dynamique de 7 marques distinctes sans modification du code applicatif.
- **File d'attente persistante (Queue) :** Traitement asynchrone débrayable avec mécanismes de reprise sur panne (*restart recovery*) et gestion des échecs (*Dead Letter Queue*).
- **Politique de retry exponentiel :** Tentatives d'envoi automatique échelonnées (1m, 5m, 30m, 2h, 8h - max 5 essais).
- **Idempotence stricte :** Déduplication via `Idempotency-Key` sur tous les canaux d'envoi.
- **Sécurité & Isolation RLS :** Contrôle d'accès granulaire via Supabase RLS, sessions HttpOnly et clés d'API dédiées (`EMAIL_PROXY_KEY`).
- **Audit immuable :** Journalisation complète de tous les envois (`EmailLog`) pour la conformité et le débogage.

---

## 📚 Table des matières de la documentation

Toute la documentation technique du service est structurée dans les fichiers suivants :

| Fichier | Objet & Contenu |
| :--- | :--- |
| 📖 [**API.md**](./API.md) | **Référence API complète** — Tous les endpoints REST, contrats JSON, schémas de requête/réponse, codes HTTP (200, 400, 401, 403, 500) et exemples `curl`. |
| 🗄️ [**DATABASE.md**](./DATABASE.md) | **Schéma de base de données** — Structure des 4 tables (`Brand`, `EmailTemplate`, `EmailQueue`, `EmailLog`), indexation, triggers, politiques RLS, diagramme ER Mermaid et données de seed. |
| 🔄 [**QUEUE.md**](./QUEUE.md) | **Moteur de file d'attente & Worker** — Diagramme d'états Mermaid, logique de retry exponentiel, gestion des erreurs, récupération post-crash et garantie d'idempotence. |
| 🏷️ [**MULTI-BRAND.md**](./MULTI-BRAND.md) | **Guide multi-marques** — Architecture *data-driven*, procédure d'ajout de marque sans code, surcharge SMTP par marque, templates/signatures et fiches des 7 marques. |
| 🛡️ [**SECURITY.md**](./SECURITY.md) | **Modèle de sécurité & Conformité** — Double mode d'authentification (HttpOnly Session vs `EMAIL_PROXY_KEY`), protection CSRF/SameOrigin, validation et traçabilité immuable. |
| 🏗️ [**ARCHITECTURE.md**](./ARCHITECTURE.md) | **Vue d'ensemble architecturale** — Diagrammes de flux Mermaid, intégration dans Cockpit v3 (Hub Central), rôle du Worker asynchrone et liaisons aux services tiers. |

---

## 🛠️ Stack Technique

- **Runtime Backend :** Node.js / Express.js
- **Persistance & Base de données :** Supabase PostgreSQL v15+ (avec RLS)
- **Moteur SMTP / Transport :** Nodemailer (connexions TLS/SSL poolées)
- **Moteur IMAP / Lecture :** node-imap & mailparser
- **Stockage d'idempotence :** Cache mémoire LRU + Table PostgreSQL `EmailQueue`
- **Fréquence du Worker :** Polling asynchrone toutes les 30 secondes

---

## 🚦 Démarrage rapide en local

### 1. Variables d'environnement requises

Créer un fichier `.env` ou vérifier les variables suivantes sur le serveur :

```bash
# Authentification et Proxy
EMAIL_PROXY_KEY=sk_live_email_proxy_jsinnovia_2026_sec_xyz
AGENT_API_KEY=sk_live_agent_cockpit_2026

# Identifiants SMTP IONOS par défaut
EMAIL_JSINNOVIA_ADDRESS=info@jsinnovia.com
EMAIL_PASSWORD=votre_mot_de_passe_ionos
EMAIL_ASSURANCES_ADDRESS=info@assurances-dour.be
EMAIL_PASSWORD_ASSURANCES=votre_mot_de_passe_assurances
EMAIL_STORE_ADDRESS=info@jsinnovia.store
EMAIL_PASSWORD_STORE=votre_mot_de_passe_store

# Connexion Supabase
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

### 2. Exécution des migrations SQL

Appliquer la migration SQL située dans `migrations/` sur la base de données Supabase.

### 3. Lancement des tests automatisés

```bash
npm test tests/official-email.test.cjs
```
