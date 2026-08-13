# Implémentation Technique RGPD — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit  
**Statut juridique :** **A VALIDER JURIDIQUEMENT** (Toutes les bases légales, durées et statuts sont 'pending')  
**Version :** 1.0.0  
**Date :** 13 août 2026  

---

## 1. Vue d'Ensemble du Modèle de Données RGPD

L'implémentation de la conformité au Règlement Général sur la Protection des Données (RGPD) repose sur le schéma PostgreSQL `governance` hébergé sur le projet Supabase métier (`gfjpryakxzdzwnazlsfz`).

Ce schéma regroupe 5 tables fondamentales pour répondre aux exigences réglementaires :

1. `governance.processing_activity` (Art. 30 — Registre des Traitements)
2. `governance.subprocessor_registry` (Art. 28 — Registre des Sous-traitants)
3. `governance.consent_record` (Art. 7 — Traçabilité des Consentements)
4. `governance.data_subject_request` (Art. 12-22 — Demandes d'Exercice de Droits)
5. `governance.retention_policy` (Art. 5.1.e — Politiques de Conservation)

---

## 2. Registre des Traitements (`processing_activity`) — Art. 30

Chaque activité traitant des données à caractère personnel fait l'objet d'une fiche détaillée dans la table `processing_activity`.

### Champs Clés de la Table
- `name` : Nom du traitement (ex: *Gestion de la facturation client*, *Prospection commerciale B2B*).
- `purpose` : Finalité explicite du traitement.
- `categories_of_persons` : Personnes concernées (ex: *Clients*, *Prospects*, *Collaborateurs*).
- `categories_of_data` : Types de données collectées (ex: *Identité, Coordonnées, Historique d'achats*).
- `legal_basis` : Base légale pressentie (ex: `contract`, `legal_obligation`, `legitimate_interest`, `consent`).
- `legal_basis_note` : Explication de la base légale.
- `recipients` : Destinataires internes ou externes des données.
- `subprocessors` : Liste des sous-traitants engagés.
- `transfers_outside_eee` : Indicateur BVC (True/False) sur le transfert hors Espace Économique Européen.
- `transfer_mechanism` : Mécanisme d'encadrement du transfert (ex: `scc`, `adequacy`, `pending`).
- `retention_period` : Durée de conservation appliquée.
- `security_measures` : Description des mesures techniques et organisationnelles (TOMs).
- `legal_validation_status` : Statut de validation juriste (`pending`, `validated`, `rejected`). En l'état : **`pending`**.

---

## 3. Registre des Sous-Traitants (`subprocessor_registry`) — Art. 28

La table `subprocessor_registry` répertorie l'ensemble des prestataires techniques tiers ayant accès directement ou indirectement à des données traitées par le Cockpit.

### Structure des Fiches Sous-Traitants
- `provider_name` : Raison sociale du sous-traitant (ex: *Railway, Supabase, Dropbox, OpenAI, Stripe*).
- `service_purpose` : Service fourni.
- `categories_of_data` : Données confiées.
- `processing_location` : Zone géographique de traitement (UE, USA, Global).
- `dpa_signed` : État de la signature de l'accord de traitement de données (DPA - Data Processing Agreement). Initialement `false` / `pending`.
- `transfer_mechanism` : Clauses Contractuelles Types (`scc`), Décision d'Adéquation (`adequacy`), ou `pending`.
- `validation_status` : Initialement fixé à **`pending`**.

---

## 4. Registre des Consentements (`consent_record`) — Art. 7

Le suivi dynamique des consentements accordés ou retirés par les personnes concernées est conservé dans `consent_record`.

### Cycle de Vie d'un Consentement
1. **Création (`active`) :** L'utilisateur valide un formulaire (ex: inscription newsletter, acceptation CGU/Politique). Les métadonnées de preuve (`proof_metadata`) et l'empreinte du texte accepté (`text_hash`) sont enregistrées.
2. **Retrait (`withdrawn`) :** Dès l'action de désinscription ou de retrait via l'espace dédié, le champ `withdrawn_at` est complété et le statut passe à `withdrawn`.
3. **Expiration (`expired`) :** Passage automatique en statut expiré une fois la durée de validité atteinte.

---

## 5. Gestion des Demandes d'Exercice de Droits (`data_subject_request`)

Pour répondre aux obligations des articles 12 à 22 du RGPD, toute demande émanant d'une personne concernée est consignée et suivie dans `data_subject_request`.

### Traçabilité et Échéance Légale
- **Types de demandes :** `access`, `rectification`, `erasure`, `restriction`, `objection`, `portability`, `withdraw_consent`.
- **Calcul automatique de l'échéance :** `due_date` est automatiquement initialisé à **`now() + INTERVAL '30 days'`**.
- **Statuts du Workflow :**
  - `received` (Demande reçue)
  - `in_review` (En cours d'analyse d'identité et de faisabilité)
  - `processing` (Traitement technique en cours)
  - `completed` (Demande exécutée)
  - `rejected` (Demande rejetée avec motif légal)
  - `partially_completed` (Exécutée partiellement - ex: effacement partiel en raison de conservation légale comptable).

---

## 6. Politiques de Conservation (`retention_policy`)

La table `retention_policy` définit les règles d'archivage et de destruction des données par catégorie.

- `category` : Clé de catégorie (ex: `lead`, `client`, `invoice`, `audit_log`).
- `retention_period_days` : Durée proposée en jours.
- `action_on_expiry` : Action automatique ou manuelle en fin de période (`delete`, `anonymize`, `archive`, `review`).
- `validation_status` : Fixé à **`pending`** pour toute la politique.

---

## 7. Engagement de Validation Juridique

> **STATUT : A VALIDER JURIDIQUEMENT**  
> L'ensemble des structures, paramètres, durées et bases légales configurés dans le schéma `governance` constituent le cadre technique applicatif. Aucun traitement n'est considéré comme juridiquement définitif tant qu'un avis favorable écrit n'a pas été rendu par un conseil juridique ou un DPO désigné.
