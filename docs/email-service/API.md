# Référence API — Email Core Framework

Ce document décrit l'ensemble des points d'entrée HTTP (endpoints) exposés par le service d'emails du **Cockpit JS-Innov.IA**.

---

## 🔑 Modes d'Authentification & Rôles

Le service supporte deux mécanismes d'authentification stricts :
1. **Session HttpOnly (`requireSession`) :** Utilisée par l'interface web Cockpit v3.
   - Requiert un cookie de session valide émis après authentification par l'application.
   - Les rôles minimums applicatifs sont : `viewer`, `operator`, `admin`.
2. **Clé API d'agent (`EMAIL_PROXY_KEY`) :** Utilisée pour les intégrations machine-to-machine, microservices externes, workflows n8n et scripts automatisés.
   - Requiert le header HTTP `x-agent-key: <EMAIL_PROXY_KEY>`.
   - **Interdiction formelle** de faire transiter la clé dans les paramètres d'URL (`query string`).

---

## 📌 Sommaire des Endpoints

1. [POST /api/emails/send](#1-post-apiemailssend) — Soumettre un email à la file d'attente
2. [GET /api/emails/logs](#2-get-apiemailslogs) — Consulter les journaux d'envoi
3. [GET /api/emails/:id](#3-get-apiemailsid) — Obtenir le détail d'un email (Log & Queue)
4. [POST /api/emails/:id/retry](#4-post-apiemailsidretry) — Re-déclencher l'envoi d'un email en échec
5. [POST /api/emails/:id/cancel](#5-post-apiemailsidcancel) — Annuler un email en attente
6. [GET /api/emails/stats](#6-get-apiemailsstats) — Statistiques agrégées des envois
7. [GET /api/emails/templates](#7-get-apiemailstemplates) — Lister les modèles d'emails
8. [POST /api/emails/templates](#8-post-apiemailstemplates) — Créer un modèle d'email
9. [PUT /api/emails/templates/:id](#9-put-apiemailstemplatesid) — Modifier un modèle d'email
10. [DELETE /api/emails/templates/:id](#10-delete-apiemailstemplatesid) — Supprimer un modèle d'email
11. [GET /api/emails/brands](#11-get-apiemailsbrands) — Lister les marques configurées
12. [POST /api/emails/official](#12-post-apiemailsofficial-backward-compat) — Envoi officiel synchrone (Compatibilité ascendante)

---

## 1. POST /api/emails/send

Ajoute un email dans la file d'attente persistante (`EmailQueue`) pour un traitement asynchrone par le Worker.

- **Méthode :** `POST`
- **URL :** `/api/emails/send`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `operator` (Session) ou `service_role` (API Key)
- **Headers requis :**
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID-ou-string-8-128-chars>` *(recommandé)*
  - `x-agent-key: <EMAIL_PROXY_KEY>` *(si accès externe)*

### Body de la requête (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["brand_code", "to", "subject"],
  "properties": {
    "brand_code": {
      "type": "string",
      "description": "Code unique de la marque (ex: jsinnovia, assurances, store, villeconnect, letourdedour, synergiedour, fashionistart)"
    },
    "template_code": {
      "type": "string",
      "description": "Code du template à utiliser (ex: WELCOME_EMAIL, INVOICE_NOTICE). Si omis, text ou html est requis."
    },
    "template_variables": {
      "type": "object",
      "description": "Clés/Valeurs pour la substitution dynamique des variables dans le template"
    },
    "to": {
      "oneOf": [
        { "type": "string", "format": "email" },
        { "type": "array", "items": { "type": "string", "format": "email" }, "minItems": 1, "maxItems": 20 }
      ],
      "description": "Adresse email ou tableau d'adresses destinataires"
    },
    "subject": {
      "type": "string",
      "maxLength": 200,
      "description": "Sujet de l'email (peut être généré automatiquement depuis le template)"
    },
    "text": {
      "type": "string",
      "maxLength": 500000,
      "description": "Contenu brut au format texte"
    },
    "html": {
      "type": "string",
      "maxLength": 500000,
      "description": "Contenu au format HTML"
    },
    "cc": {
      "type": "array",
      "items": { "type": "string", "format": "email" }
    },
    "bcc": {
      "type": "array",
      "items": { "type": "string", "format": "email" }
    },
    "reply_to": {
      "type": "string",
      "format": "email"
    },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["filename", "content"],
        "properties": {
          "filename": { "type": "string" },
          "content": { "type": "string", "description": "Contenu encodé en base64" },
          "contentType": { "type": "string" }
        }
      }
    },
    "metadata": {
      "type": "object",
      "maxProperties": 5,
      "description": "Métadonnées arbitraires enregistrées dans le journal d'envoi"
    }
  }
}
```

### Exemples de Réponses

#### `200 OK` (Message mis en file d'attente)
```json
{
  "success": true,
  "queue_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "pending",
  "idempotency_key": "req-2026-08-05-001",
  "message": "Email queued successfully for brand jsinnovia"
}
```

#### `400 Bad Request` (Validation échouée)
```json
{
  "success": false,
  "error": "Validation error: 'to' must be a valid email address, 'brand_code' is required."
}
```

#### `401 Unauthorized`
```json
{
  "success": false,
  "error": "Unauthorized — Missing or invalid authentication key"
}
```

#### `409 Conflict` (Télescopage Idempotency-Key)
```json
{
  "success": false,
  "error": "Concurrent request or key already used with different payload"
}
```

#### `500 Internal Server Error`
```json
{
  "success": false,
  "error": "Database error while inserting into EmailQueue"
}
```

### Exemple `curl`

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/send \
  -H "Content-Type: application/json" \
  -H "x-agent-key: $EMAIL_PROXY_KEY" \
  -H "Idempotency-Key: order-invoice-10294" \
  -d '{
    "brand_code": "store",
    "to": "client@example.com",
    "subject": "Confirmation de votre commande #10294",
    "template_code": "ORDER_CONFIRMATION",
    "template_variables": {
      "first_name": "Jean",
      "order_id": "10294",
      "total_amount": "149.00 €"
    },
    "metadata": { "order_id": "10294", "customer_id": "usr_88" }
  }'
```

---

## 2. GET /api/emails/logs

Consulte la liste paginée des journaux d'envoi d'emails (`EmailLog`).

- **Méthode :** `GET`
- **URL :** `/api/emails/logs`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `viewer` (Session) ou `service_role` (API Key)
- **Paramètres Query :**
  - `brand_code` *(optionnel)* : Filtrer par marque.
  - `status` *(optionnel)* : `sent`, `failed`, `pending`, `cancelled`.
  - `limit` *(optionnel, def: 50, max: 100)* : Nombre de résultats.
  - `offset` *(optionnel, def: 0)* : Pagination.

### Exemples de Réponses

#### `200 OK`
```json
{
  "success": true,
  "total": 1420,
  "limit": 20,
  "offset": 0,
  "data": [
    {
      "id": "e3a4b087-4d92-4f33-82b1-50e599b5a034",
      "brand_code": "assurances",
      "to": "contact@assure.be",
      "subject": "Votre attestation d'assurance",
      "status": "sent",
      "message_id": "<202608050630.abc12345@smtp.ionos.fr>",
      "error_message": null,
      "sent_at": "2026-08-05T06:30:12.450Z",
      "created_at": "2026-08-05T06:30:00.120Z"
    }
  ]
}
```

### Exemple `curl`

```bash
curl -X GET "https://cockpit.jsinnovia.com/api/emails/logs?brand_code=assurances&status=sent&limit=10" \
  -H "x-agent-key: $EMAIL_PROXY_KEY"
```

---

## 3. GET /api/emails/:id

Récupère le détail complet d'un email à partir de son identifiant unique UUID (`EmailLog` / `EmailQueue`).

- **Méthode :** `GET`
- **URL :** `/api/emails/:id`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `viewer`

### Exemples de Réponses

#### `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "e3a4b087-4d92-4f33-82b1-50e599b5a034",
    "brand_code": "assurances",
    "sender_email": "info@assurances-dour.be",
    "to": ["contact@assure.be"],
    "cc": [],
    "subject": "Votre attestation d'assurance",
    "body_text": "Bonjour, veuillez trouver ci-joint...",
    "body_html": "<p>Bonjour, veuillez trouver ci-joint...</p>",
    "status": "sent",
    "attempts": 1,
    "last_attempt_at": "2026-08-05T06:30:12.450Z",
    "message_id": "<202608050630.abc12345@smtp.ionos.fr>",
    "smtp_response": "250 Message accepted",
    "metadata": { "policy_number": "POL-99281" },
    "created_at": "2026-08-05T06:30:00.120Z"
  }
}
```

#### `404 Not Found`
```json
{ "success": false, "error": "Email record not found with id e3a4b087-4d92-4f33-82b1-50e599b5a034" }
```

### Exemple `curl`

```bash
curl -X GET https://cockpit.jsinnovia.com/api/emails/e3a4b087-4d92-4f33-82b1-50e599b5a034 \
  -H "x-agent-key: $EMAIL_PROXY_KEY"
```

---

## 4. POST /api/emails/:id/retry

Reprogramme immédiatement une tentative d'envoi pour un email bloqué au statut `failed` ou dans la *Dead Letter Queue*.

- **Méthode :** `POST`
- **URL :** `/api/emails/:id/retry`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `operator`

### Exemples de Réponses

#### `200 OK`
```json
{
  "success": true,
  "queue_id": "e3a4b087-4d92-4f33-82b1-50e599b5a034",
  "status": "pending",
  "next_attempt_at": "2026-08-05T06:35:00.000Z",
  "message": "Email requeued for immediate attempt"
}
```

#### `400 Bad Request`
```json
{ "success": false, "error": "Cannot retry email with status 'sent' or 'cancelled'" }
```

### Exemple `curl`

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/e3a4b087-4d92-4f33-82b1-50e599b5a034/retry \
  -H "x-agent-key: $EMAIL_PROXY_KEY"
```

---

## 5. POST /api/emails/:id/cancel

Annule un email encore en attente (`pending` ou `retry`) dans la file d'attente avant son exécution par le worker.

- **Méthode :** `POST`
- **URL :** `/api/emails/:id/cancel`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `operator`

### Exemples de Réponses

#### `200 OK`
```json
{
  "success": true,
  "queue_id": "e3a4b087-4d92-4f33-82b1-50e599b5a034",
  "status": "cancelled",
  "message": "Email successfully cancelled"
}
```

#### `400 Bad Request`
```json
{ "success": false, "error": "Email is already sent or executing and cannot be cancelled" }
```

### Exemple `curl`

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/e3a4b087-4d92-4f33-82b1-50e599b5a034/cancel \
  -H "x-agent-key: $EMAIL_PROXY_KEY"
```

---

## 6. GET /api/emails/stats

Retourne les métriques et statistiques d'envoi agrégées par marque ou globales.

- **Méthode :** `GET`
- **URL :** `/api/emails/stats`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `viewer`
- **Paramètres Query :** `period` (`24h`, `7d`, `30d`, def: `24h`)

### Exemple de Réponse `200 OK`

```json
{
  "success": true,
  "period": "24h",
  "totals": {
    "sent": 348,
    "pending": 4,
    "failed": 2,
    "cancelled": 1,
    "success_rate_percent": 99.42
  },
  "by_brand": {
    "jsinnovia": { "sent": 120, "failed": 0 },
    "assurances": { "sent": 150, "failed": 1 },
    "store": { "sent": 78, "failed": 1 }
  }
}
```

### Exemple `curl`

```bash
curl -X GET "https://cockpit.jsinnovia.com/api/emails/stats?period=7d" \
  -H "x-agent-key: $EMAIL_PROXY_KEY"
```

---

## 7. GET /api/emails/templates

Liste tous les modèles d'emails (`EmailTemplate`) enregistrés.

- **Méthode :** `GET`
- **URL :** `/api/emails/templates`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `viewer`
- **Paramètres Query :** `brand_code` *(optionnel)*

### Exemple de Réponse `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "tpl_welcome_01",
      "brand_code": "jsinnovia",
      "code": "WELCOME_EMAIL",
      "name": "Bienvenue sur Cockpit JS-Innov.IA",
      "subject_template": "Bienvenue {{first_name}} dans l'écosystème JS-Innov.IA",
      "is_active": true,
      "updated_at": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

---

## 8. POST /api/emails/templates

Crée un nouveau modèle d'email dans la table `EmailTemplate`.

- **Méthode :** `POST`
- **URL :** `/api/emails/templates`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `admin`

### Body JSON

```json
{
  "brand_code": "villeconnect",
  "code": "CITIZEN_ALERT",
  "name": "Alerte Citoyenne VilleConnect",
  "subject_template": "Alerte : {{alert_title}} - Commune de {{city_name}}",
  "html_template": "<h1>Alerte {{alert_title}}</h1><p>{{alert_description}}</p>",
  "text_template": "Alerte {{alert_title}} : {{alert_description}}"
}
```

### Exemple `curl`

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/templates \
  -H "Content-Type: application/json" \
  -H "x-agent-key: $EMAIL_PROXY_KEY" \
  -d '{
    "brand_code": "villeconnect",
    "code": "CITIZEN_ALERT",
    "name": "Alerte Citoyenne VilleConnect",
    "subject_template": "Alerte : {{alert_title}}",
    "html_template": "<p>{{alert_description}}</p>"
  }'
```

---

## 9. PUT /api/emails/templates/:id

Mets à jour un modèle d'email existant.

- **Méthode :** `PUT`
- **URL :** `/api/emails/templates/:id`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `admin`

---

## 10. DELETE /api/emails/templates/:id

Désactive ou supprime un modèle d'email.

- **Méthode :** `DELETE`
- **URL :** `/api/emails/templates/:id`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `admin`

---

## 11. GET /api/emails/brands

Liste les 7 marques configurées et leur statut.

- **Méthode :** `GET`
- **URL :** `/api/emails/brands`
- **Authentification :** Session HttpOnly OU Header `x-agent-key`
- **Rôle minimum :** `viewer`

### Exemple de Réponse `200 OK`

```json
{
  "success": true,
  "brands": [
    {
      "code": "jsinnovia",
      "name": "JS-Innov.IA Core",
      "default_from_email": "info@jsinnovia.com",
      "default_from_name": "JS-Innov.IA",
      "is_active": true
    },
    {
      "code": "assurances",
      "name": "Assurances Dour",
      "default_from_email": "info@assurances-dour.be",
      "default_from_name": "Assurances Dour",
      "is_active": true
    }
  ]
}
```

---

## 12. POST /api/emails/official (Backward Compat)

Route historique synchrone réservée aux envois système officiels depuis `info@jsinnovia.store`.

- **Méthode :** `POST`
- **URL :** `/api/emails/official`
- **Authentification STRICTE :** Header `x-agent-key: <EMAIL_PROXY_KEY>` **UNIQUEMENT**. *(Refus 401 si transmis en Query String)*.
- **Header Obigatoire :** `Idempotency-Key` (format regex `^[A-Za-z0-9_-]{8,128}$`).
- **Limites de débit :** 10 req/min par clé.

### Exemple Body JSON

```json
{
  "to": "destinataire@example.com",
  "subject": "Notification Officielle JS-Innov.IA",
  "text": "Message officiel au format texte brut."
}
```

### Exemple `curl`

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/official \
  -H "Content-Type: application/json" \
  -H "x-agent-key: $EMAIL_PROXY_KEY" \
  -H "Idempotency-Key: official-msg-88219" \
  -d '{
    "to": "client@example.com",
    "subject": "Facture officielle",
    "text": "Veuillez trouver ci-joint votre document."
  }'
```
