# Architecture de Confidentialité & Privacy by Design — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit  
**Statut juridique :** **A VALIDER JURIDIQUEMENT**  
**Version :** 1.0.0  
**Date :** 13 août 2026  

---

## 1. Principes Fondamentaux de Privacy by Design & Default

Le Cockpit JS-Innov.IA intègre les principes du Règlement Général sur la Protection des Données (RGPD - Art. 25) dès sa conception logicielle (*Privacy by Design*) et par défaut dans tous ses réglages (*Privacy by Default*).

### 1.1 Minimisation des Données
- Seules les données strictement nécessaires au fonctionnement des services métiers (gestion des prospects, facturation, suivi de projet) sont collectées.
- Les adresses IP brutes des utilisateurs ne sont pas conservées dans le journal d'audit : elles sont immédiatement transformées en empreinte cryptographique irréversible (`actor_ip_hash` via SHA-256).
- Pas de collecte de données de géolocalisation continue ni d'identificateurs publicitaires.

### 1.2 Isolation Multi-Tenant
- Chaque entité ou organisation cliente bénéficie d'une isolation logique stricte contrôlée par la colonne `organisation_id`.
- Un utilisateur appartenant au tenant A ne peut sous aucun prétexte accéder aux données à caractère personnel (DCP) des utilisateurs du tenant B.

### 1.3 Pseudonymisation & Séparation des Bases
- **Base d'Authentification (`rzvvwcwyaddzsaattwqt`) :** Stocke les identifiants de connexion (`cockpit_users`, hashs de mots de passe, sessions).
- **Base Métier (`gfjpryakxzdzwnazlsfz`) :** Stocke les dossiers métier et clients.
- Cette séparation garantit qu'une compromission isolée d'une table n'associe pas immédiatement les fichiers métiers aux comptes d'accès sans le canal backend Cockpit.

---

## 2. Matrice de Classification des Données (5 Niveaux)

Conformément à la table `governance.data_classification`, toutes les données traitées par le Cockpit sont réparties en 5 niveaux d'exigence de confidentialité :

| Niveau ID | Libellé | Description & Exemples | Code Couleur |
| :--- | :--- | :--- | :--- |
| **`public`** | **Public** | Données librement communicables. *Exemples : catalogue d'offres publiques, documentation d'API publique, mentions légales.* | `#10b981` (Vert) |
| **`internal`** | **Interne** | Usage interne JS-Innov.IA, pas de diffusion externe sans autorisation. *Exemples : procédures internes, identifiants de projets anonymisés, statistiques d'utilisation globales.* | `#3b82f6` (Bleu) |
| **`personal`** | **Personnel** | Données personnelles identifiantes (DCP au sens RGPD Art. 4). *Exemples : nom, prénom, adresse email professionnelle, numéro de téléphone des contacts clients/leads.* | `#f59e0b` (Orange) |
| **`confidential`** | **Confidentiel** | Accès restreint aux rôles autorisés — données business et financières sensibles. *Exemples : montants des devis et factures, conditions commerciales, contrats.* | `#ef4444` (Rouge) |
| **`sensitive`** | **Sensible** | Données hautement sensibles exigeant des mesures de sécurité renforcées. *Exemples : secrets d'affaires, tokens OAuth de rafraîchissement (Dropbox/Railway), clés d'API, hashs de sécurité, données financières bancaires.* | `#9911aa` (Violet) |

---

## 3. Principes de Confidentialité et Sécurité des Échanges

1. **Chiffrement de Bout en Bout en Transit :** Toutes les liaisons (Client $\leftrightarrow$ Backend, Backend $\leftrightarrow$ Supabase, Backend $\leftrightarrow$ Dropbox) imposent TLS 1.3 (ou TLS 1.2 strict) avec HTTPS.
2. **Chiffrement au Repos :** Les bases PostgreSQL Supabase et le coffre documentaire Dropbox utilisent un chiffrement AES-256 au repos.
3. **Absence d'Exposition Directe du Coffre Documentaire :** Aucun lien direct Dropbox public ou pré-signé à longue durée n'est diffusé aux clients. Le backend Cockpit vérifie l'habilitation du rôle avant d'ouvrir un flux temporaire sécurisé vers le document (`server-documents.cjs`).
4. **Principe du Moindre Privilège (PoLP) :** Les jetons d'accès API internes sont segmentés par fonction (ex: `AI_COST_INGEST_KEY`, `AGENT_API_KEY`).

---

## 4. Gestion des Consentements (`consent_record`)

Le traitement des données à caractère personnel fondé sur le consentement (notamment prospection commerciale, cookies non essentiels, intégrations tierces) est consigné de manière immuable dans `governance.consent_record`.

### Attributs de Traçabilité du Consentement
- `person_email` : Email de la personne concernée.
- `purpose` : Finalité explicite du consentement (ex: `marketing_newsletter`, `ai_data_processing`).
- `text_version` & `text_hash` : Empreinte de la version exacte de la mention d'information présentée à l'utilisateur lors de son accord.
- `given_at` : Horodatage ISO précis de l'accord.
- `withdrawn_at` : Horodatage ISO d'un éventuel retrait de consentement.
- `proof_metadata` : Métadonnées de preuve (contexte du formulaire, origine).
- `status` : État du consentement (`active`, `withdrawn`, `expired`).

---

## 5. Journal d'Audit & Contrôle d'Accès (`audit_log`)

Toute consultation, exportation, modification ou suppression de données classées `personal`, `confidential` ou `sensitive` déclenche un enregistrement dans le journal d'audit (`governance.audit_log`).

- **Inviolabilité :** Les politiques RLS du schéma `governance` interdisent la modification ou suppression des logs d'audit par les utilisateurs standards ou administrateurs via l'API publique.
- **Visualisation restreinte :** Seul le rôle `superadmin` peut consulter la vue `governance.audit_log_recent`.

---

## 6. Avertissement Légal

> **STATUT : A VALIDER JURIDIQUEMENT**  
> Les catégories de données, les règles de classification ainsi que les flux de consentement décrits dans ce document sont établis à titre de spécification technique. Ils doivent être validés par un conseiller juridique spécialisé en protection des données personnelles.
