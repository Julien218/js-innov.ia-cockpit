# Notifications WhatsApp SIGNELYA

## Routage validé

- **Panne confirmée** : client concerné + Super Admin.
- **Vidéos réellement en ligne** : uniquement le commercial attribué au client.
- Aucun envoi lors d'une simple programmation : l'événement est créé après l'ACK du Player.
- Une panne est confirmée après 300 secondes sans heartbeat par défaut.
- Le message parle d'un écran hors ligne confirmé, sans affirmer qu'il s'agit forcément d'une coupure électrique.

## Identifiants Meta

- WABA ID : `882701644569495`
- Phone Number ID : `1114555501730767`
- Application prévue : `1228432156120214`

## Variables Railway requises

```env
WHATSAPP_PHONE_NUMBER_ID=1114555501730767
WHATSAPP_WABA_ID=882701644569495
WHATSAPP_GRAPH_VERSION=v23.0
WHATSAPP_ACCESS_TOKEN=<jeton permanent>
WHATSAPP_APP_SECRET=<secret application Meta>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<valeur aléatoire longue>
WHATSAPP_TEMPLATE_LANGUAGE=fr
WHATSAPP_TEMPLATE_SCREEN_OFFLINE=signelya_screen_offline_confirmed
WHATSAPP_TEMPLATE_VIDEOS_ONLINE=signelya_client_videos_online
SIGNELYA_OFFLINE_CONFIRM_SECONDS=300
SIGNELYA_OFFLINE_MONITOR_INTERVAL_MS=60000
```

Les secrets doivent être saisis directement dans Railway, jamais dans GitHub ou une conversation.

## Webhook Meta

Callback URL :

```
https://olivier-signage-cockpit-production.up.railway.app/api/whatsapp/webhook
```

Souscrire au champ `messages`. Le serveur vérifie la signature `X-Hub-Signature-256` avec `WHATSAPP_APP_SECRET`.

## Modèles Meta

### signelya_screen_offline_confirmed

Catégorie : Utility

```
SIGNELYA — Écran hors ligne confirmé

L'écran {{1}} du client {{2}} est hors ligne depuis {{3}} minutes.
Vérifiez son alimentation électrique et sa connexion Internet.
```

### signelya_client_videos_online

Catégorie : Utility

```
SIGNELYA — Vidéos en ligne

Les vidéos de votre client {{1}} sont maintenant en ligne sur {{2}}.
```

## Consentement et contacts

Un contact n'est éligible que si `whatsapp_opt_in_at` est renseigné. Les contacts et attributions sont gérés par les endpoints Super Admin :

- `PUT /api/whatsapp/contacts/:email`
- `PUT /api/whatsapp/assignments/:clientEmail`
- `GET /api/whatsapp/status`

Le numéro d'expédition ne peut pas être utilisé comme numéro destinataire pour ses propres messages.
