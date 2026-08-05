# Architecture Générale — Email Core Framework

Ce document présente l'architecture globale du **Email Core Framework** du Cockpit JS-Innov.IA, son intégration au sein de la plateforme Cockpit v3 et les flux de données de bout en bout.

---

## 🏛️ Vue d'Ensemble : Cockpit comme Hub Central

Le **Cockpit JS-Innov.IA** agit comme le Hub d'orchestration opérationnel et technique unifié pour l'ensemble des activités et filiales. Le service d'email est l'une des briques d'infrastructure centrales, au même titre que Stripe (Paiements), la Facturation, le réseau Peppol et les Agents IA.

```
                                  ┌──────────────────────────────────────────────────┐
                                  │               JS-INNOV.IA COCKPIT                │
                                  │            (Hub Central d'Orchestration)         │
                                  └────────────────────────┬─────────────────────────┘
                                                           │
        ┌───────────────────┬──────────────────────────────┼──────────────────────────────┬───────────────────┐
        │                   │                              │                              │                   │
        ▼                   ▼                              ▼                              ▼                   ▼
┌──────────────┐   ┌──────────────────┐       ┌────────────────────────┐      ┌─────────────────┐   ┌────────────────┐
│  Stripe /    │   │ Facturation Core │       │  EMAIL CORE FRAMEWORK  │      │ Network Peppol  │   │ Copilot OS /   │
│  Paiements   │   │  & Devis / PDF   │       │  (Multi-Brand Queue)   │      │ (Fact. Electron)│   │  Agents IA     │
└──────────────┘   └──────────────────┘       └────────────┬───────────┘      └─────────────────┘   └────────────────┘
                                                           │
                                                           ▼
                                      ┌────────────────────────────────────────┐
                                      │   Écosystème des 7 Marques (DB Config) │
                                      │  JS-Innov.IA | Assurances | Store      │
                                      │  VilleConnect | Tour de Dour | ...     │
                                      └────────────────────────────────────────┘
```

---

## 🔄 Diagramme de Flux de Bout en Bout (Sequence Diagram)

Ce diagramme détaille le cheminement complet d'une demande d'envoi d'email, depuis une application externe ou l'IHM Cockpit jusqu'à la réception du courriel par le destinataire final :

```mermaid
sequenceDiagram
    autonumber
    actor ExternalApp as Client / App Externe
    actor CockpitUI as Cockpit UI (React)
    participant API as Express API (/api/emails)
    participant Auth as Auth Middleware
    participant Queue as Supabase EmailQueue DB
    participant Log as Supabase EmailLog DB
    participant Worker as Background Worker (30s)
    participant SMTP as Serveur SMTP (IONOS / Brand Override)
    actor Recipient as Destinataire Final

    alt Appel depuis Cockpit UI
        CockpitUI->>API: POST /api/emails/send (Cookie HttpOnly)
    else Appel depuis Microservice / Agent / n8n
        ExternalApp->>API: POST /api/emails/send (Header x-agent-key + Idempotency-Key)
    end

    API->>Auth: Vérification des crédentiels / session & Idempotence
    Auth-->>API: Authentification & Validation Payload OK

    API->>Queue: INSERT INTO EmailQueue (status='pending', brand_code, idempotency_key)
    Queue-->>API: Confirmation Insertion (queue_id)
    
    API-->>ExternalApp: Response 200 OK { success: true, queue_id, status: 'pending' }

    loop Polling du Worker (Toutes les 30 secondes)
        Worker->>Queue: SELECT & LOCK 20 pending rows (FOR UPDATE SKIP LOCKED)
        Queue-->>Worker: Retourne les travaux réservés (status='sending')
        
        Worker->>Queue: Chargement Brand config & SMTP credentials
        Worker->>SMTP: Envoi du mail via nodemailer (TLS / Pool)
        
        alt Envoi SMTP Réussi (250 OK)
            SMTP-->>Worker: Confirm 250 OK + Message-ID
            Worker->>Queue: UPDATE status='sent', sent_at=now()
            Worker->>Log: INSERT INTO EmailLog (status='sent', message_id)
            SMTP-->>Recipient: Envoi physique de l'email
        else Erreur SMTP / Réseau temporaire
            SMTP-->>Worker: Erreur 535 / Socket Timeout
            Worker->>Queue: UPDATE attempts=attempts+1, status='failed', next_attempt_at=(backoff)
            Worker->>Log: INSERT INTO EmailLog (status='failed', error_message)
        end
    end
```

---

## 🧩 Composants Clés du Système

### 1. Layer Web / Routeur Express (`server-email.cjs`)
- Expose la façade REST standardisée.
- Intercepte, valide et assainit la structure des corps de requête JSON.
- Gère la déduplication en mémoire vive (cache LRU d'idempotence) couplée à la persistance PostgreSQL.

### 2. Base de Données Supabase PostgreSQL
- **`email_brands` :** Referentiel dynamique des 7 marques.
- **`email_templates` :** Bibliothèque des gabarits HTML.
- **`email_queue` :** File d'attente résiliente avec verrous transactionnels `FOR UPDATE SKIP LOCKED`.
- **`email_logs` :** Historique audit immuable.

### 3. Worker Asynchrone
- Processus autonome qui scrute la base de données à intervalles réguliers (30 secondes).
- Gère le cycle de vie des tâches, les reprises sur échec, le ré-essayage exponentiel et le nettoyage des tâches bloquées.

### 4. Moteur Transport Nodemailer
- Crée et gère des pools de connexions SMTP réutilisables vers IONOS ou vers les serveurs SMTP dédiés configurés dans `smtp_override`.
- Prend en charge la conversion MIME, l'encodage UTF-8, le support des pièces jointes et les signatures HTML.

---

## 🏬 Les 7 Marques Configurables via la Base de Données

Toutes les marques de l'écosystème partagent la même infrastructure d'envoi tout en conservant une étanchéité complète au niveau visuel et identitaire :

1. **JS-Innov.IA Core (`jsinnovia`) :** Notifications système, alertes d'administration et communications corporate holding.
2. **Assurances Dour (`assurances`) :** Attestations d'assurance, avis d'échéance et gestion des sinistres client.
3. **JS-Innov.IA Store (`store`) :** Confirmations de commande, factures d'achat et clés de licences logicielles.
4. **VilleConnect / Copilot OS (`villeconnect`) :** Communications citoyennes, alertes communales et synthèses administratives.
5. **Le Tour de Dour (`letourdedour`) :** Newsletters régionales, invitations événements et partenariats culturels.
6. **Synergie Dour (`synergiedour`) :** Mails du réseau des commerçants, invitations aux réunions d'affaires local.
7. **Miss & Mister Dour / Fashionist'ART (`fashionistart`) :** Confirmations d'inscriptions aux concours, billetterie et actualités mode/art.
