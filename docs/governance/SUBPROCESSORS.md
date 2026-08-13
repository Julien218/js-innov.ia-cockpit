# Registre des Sous-Traitants (Subprocessors) — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit
**Référence réglementaire :** RGPD Article 28
**Statut juridique :** **A VALIDER JURIDIQUEMENT** (Tous les contrats DPA et mécanismes de transfert sont en cours de validation)
**Version :** 1.0.0
**Date :** 13 août 2026

---

## 1. Introduction & Engagements de l'Article 28

Conformément à l'article 28 du RGPD, JS-Innov.IA tient à jour la liste complète de ses sous-traitants ultérieurs (*subprocessors*) intervenant dans l'hébergement, le traitement, la sécurité, l'analyse ou la gestion des données à caractère personnel confiées par ses clients.

Chaque sous-traitant fait l'objet d'un suivi au sein de la table `governance.subprocessor_registry`.

---

## 2. Liste des Sous-Traitants Homologués

> **STATUT GENERAL :** Les statuts DPA (*Data Processing Agreement*) et les validations juridiques sont marqués **`pending` / `false`** dans l'attente de la revue juridique globale.

| Fournisseur | Finalité du Service | Catégories de Données Traitées | Localisation des Serveurs | Statut DPA (`dpa_signed`) | Mécanisme de Transfert Hors UE | Statut de Validation (`validation_status`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Railway** | Hébergement backend API Node.js & Base de données PostgreSQL | Toutes données métier, logs d'accès, variables d'environnement | USA / UE | `false` | `pending` | **A VALIDER JURIDIQUEMENT** |
| **Supabase** | Base de données PostgreSQL managée & Service d'Authentification | Données utilisateurs, profils, données métier (Client, Devis, Facture) | UE (Frankfurt / AWS eu-central-1) | `false` | `adequacy` (Décision d'adéquation UE) | **A VALIDER JURIDIQUEMENT** |
| **Dropbox** | Coffre documentaire sécurisé (Stockage de fichiers physiques) | Fichiers jointes, factures PDF, devis, contrats, documents clients | USA | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |
| **OpenAI** | Modèles de langage IA (GPT-4o, GPT-5.6) | Prompts, résumés, transcriptions, analyses d'emails, données texte | USA | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |
| **xAI** | Modèles de langage IA (Grok) | Prompts, analyses d'assistance, requêtes de synthèse | USA | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |
| **IONOS** | Messagerie professionnelle IMAP/SMTP (`assurances-dour.be`, `jsinnovia.com`) | Contenu des emails, adresses, métadonnées d'envoi et de réception | UE (Allemagne / France) | `false` | `adequacy` (Décision d'adéquation UE) | **A VALIDER JURIDIQUEMENT** |
| **Stripe** | Traitement des paiements en ligne & abonnements | Données de facturation, coordonnées bancaires, transactions | USA / UE | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |
| **Peppol** | Réseau d'échange de facturation électronique B2B/B2G | Factures électroniques XML, identifiants d'entreprises | UE | `false` | `adequacy` (Décision d'adéquation UE) | **A VALIDER JURIDIQUEMENT** |
| **Google** | Drive, Calendar, Authentification OAuth2 | Fichiers synchronisés, évènements d'agenda, emails de contact | Global / USA | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |
| **Base44** | Plateforme d'Agents IA & Moteur d'Automatisations | Conversations, mémoire contextuelle de l'agent IA, tâches | USA / UE | `false` | `scc` (Clauses Contractuelles Types) | **A VALIDER JURIDIQUEMENT** |

---

## 3. Détail des Mécanismes de Transfert

- **`adequacy` (Décision d'adéquation) :** Traitement réalisé exclusivement au sein de l'Union Européenne ou dans un pays reconnu par la Commission Européenne comme offrant un niveau de protection adéquat.
- **`scc` (Clauses Contractuelles Types - Standard Contractual Clauses) :** Pour les sous-traitants situés aux États-Unis (ex: Dropbox, OpenAI, xAI, Google, Base44, Railway), encadrement par la signature des CCT de la Commission Européenne accompagnées des mesures complémentaires de sécurité nécessaires.
- **`pending` :** Dossier d'encadrement contractuel en cours de constitution et de vérification.

---

## 4. Obligation de Notification des Changements de Sous-Traitants

Conformément à l'article 28.2 du RGPD :
1. Toute adjonction ou remplacement d'un sous-traitant ultérieur sera consigné dans `governance.subprocessor_registry`.
2. Les clients seront informés au moins **30 jours à l'avance** de toute modification de la présente liste afin de pouvoir émettre leurs observations ou objections.

---

## 5. Avertissement Légal

> **STATUT : A VALIDER JURIDIQUEMENT**
> L'ensemble des mentions relatives aux contrats DPA et aux mécanismes de transfert hors UE contenues dans ce registre doit être formellement audité et validé par un juriste spécialisé avant toute signature de convention de traitement de données avec nos clients.
