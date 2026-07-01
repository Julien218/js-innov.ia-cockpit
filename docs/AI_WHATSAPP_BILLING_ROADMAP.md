# Module IA métier — WhatsApp, tâches, validation et facturation

## Objectif

Créer dans le cockpit JS-Innov.IA un module métier capable de transformer les demandes clients en tâches, contenus à valider, lignes facturables et brouillons de factures, avec une future connexion WhatsApp.

## Flux cible

```text
Client WhatsApp
  ↓
Conversation Client + Julien + Agent IA
  ↓
Analyse de la demande
  ↓
Création automatique d'une tâche cockpit
  ↓
Préparation du livrable par l'agent
  ↓
Validation humaine Julien
  ↓
Envoi au client
  ↓
Ajout ligne facturable
  ↓
Brouillon de facture
  ↓
Validation humaine
  ↓
Envoi facture
```

## Principes de sécurité

- Aucun email envoyé sans validation humaine.
- Aucune facture envoyée sans validation humaine.
- Aucun message WhatsApp sortant automatique en mode production sans validation.
- Toute action IA doit créer une trace dans un journal.
- Les clés API restent dans `.env.local`, Railway ou Supabase Secrets, jamais dans GitHub.

## Tables Supabase proposées

### ai_requests

Demandes brutes provenant de WhatsApp, email, cockpit ou formulaire.

Champs recommandés :

- id
- source
- client_id
- contact_name
- contact_phone
- contact_email
- raw_message
- summary
- status
- priority
- created_at
- updated_at

### ai_tasks

Tâches générées par l'agent.

Champs recommandés :

- id
- request_id
- client_id
- title
- description
- deliverable_type
- status
- assigned_to
- due_date
- validation_status
- created_at
- updated_at

### ai_usage_logs

Journal de consommation IA.

Champs recommandés :

- id
- task_id
- provider
- model
- input_tokens
- output_tokens
- estimated_cost
- internal_price
- billable_price
- created_at

### billing_items

Lignes facturables avant facture.

Champs recommandés :

- id
- client_id
- task_id
- label
- quantity
- unit_price
- vat_rate
- total_ht
- total_ttc
- status
- created_at

### invoices

Factures ou brouillons de factures.

Champs recommandés :

- id
- client_id
- invoice_number
- status
- total_ht
- total_vat
- total_ttc
- pdf_url
- sent_at
- paid_at
- created_at

### whatsapp_threads

Conversations WhatsApp.

Champs recommandés :

- id
- client_id
- phone
- thread_status
- last_message_at
- created_at

### whatsapp_messages

Messages entrants/sortants.

Champs recommandés :

- id
- thread_id
- direction
- sender_type
- body
- media_url
- provider_message_id
- status
- created_at

## Phases de développement

### Phase 1 — Module demandes IA

- Page cockpit `/demandes-ia`.
- Création manuelle d'une demande.
- Transformation en tâche.
- Statuts : brouillon, à valider, validé, envoyé, facturable.

### Phase 2 — Journal IA et coûts

- Calcul du coût estimé par fournisseur.
- Distinction coût interne / prix facturé.
- Historique par tâche et par client.

### Phase 3 — Facturation assistée

- Création de lignes facturables.
- Brouillon facture.
- Validation humaine.
- Génération PDF.

### Phase 4 — WhatsApp

- Webhook entrant WhatsApp Business Cloud API ou Make.
- Création automatique de demande.
- Réponse proposée par l'agent.
- Envoi seulement après validation.

### Phase 5 — Conversation à trois

- Client, Julien et agent IA dans le même fil.
- L'agent résume et propose des tâches.
- Julien valide/modifie/refuse.

## Variables d'environnement futures

```env
WHATSAPP_PROVIDER=meta_cloud_api
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
BILLING_DEFAULT_VAT_RATE=21
AI_BILLING_MODE=human_validation
```

## Règle opérationnelle

Le cockpit doit rester un système à validation humaine : l'agent prépare, Julien valide, le système exécute.
