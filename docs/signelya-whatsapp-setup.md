# Notifications SIGNELYA

## Routage validé

| Événement | Client concerné | Commercial attribué | Super Admin |
| --- | --- | --- | --- |
| Écran hors ligne confirmé | WhatsApp | Aucun message | Notification mobile + e-mail |
| Vidéos réellement en ligne après ACK Player | Aucun message | WhatsApp, uniquement pour son client | Aucun message |

- Aucun envoi lors d'une simple programmation : l'événement « vidéos en ligne » est créé après l'ACK du Player.
- Une mise hors ligne est confirmée après 300 secondes sans heartbeat par défaut.
- L'alerte ne prétend pas qu'il s'agit forcément d'une coupure électrique : elle demande de vérifier l'alimentation et Internet.
- Un écran déjà hors ligne lors de l'activation ne déclenche pas d'alerte historique. L'envoi exige une transition observée **en ligne → hors ligne confirmé**.
- Le commutateur global est désactivé par défaut afin qu'aucun message réel ne parte avant le test contrôlé.

## Identifiants Meta

- WABA ID : `882701644569495`
- Phone Number ID : `1114555501730767`
- Application prévue : `1228432156120214`

## Variables Railway requises

```env
SIGNELYA_NOTIFICATIONS_ENABLED=false
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
SIGNELYA_SUPERADMIN_ALERT_EMAIL=info@jsinnovia.store
SIGNELYA_VAPID_PUBLIC_KEY=<clé publique VAPID>
SIGNELYA_VAPID_PRIVATE_KEY=<clé privée VAPID>
SIGNELYA_VAPID_SUBJECT=mailto:info@jsinnovia.store
```

Les secrets doivent être saisis directement dans Railway, jamais dans GitHub ou une conversation. Les identifiants SMTP existants `EMAIL_STORE_ADDRESS` et `EMAIL_PASSWORD_STORE` sont utilisés pour l'e-mail Super Admin.

Pour générer une paire VAPID une seule fois :

```bash
npx web-push generate-vapid-keys
```

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

## Consentement, contacts et attribution

Un contact WhatsApp n'est éligible que si `whatsapp_opt_in_at` est renseigné. Les contacts et attributions sont gérés par les endpoints Super Admin :

- `PUT /api/whatsapp/contacts/:email`
- `PUT /api/whatsapp/assignments/:clientEmail`
- `GET /api/whatsapp/status`

Le numéro d'expédition ne peut pas être utilisé comme numéro destinataire pour ses propres messages.

## Activation des notifications mobiles

1. Ouvrir le cockpit sur le téléphone avec le compte Super Admin.
2. Sur iPhone, ajouter d'abord SIGNELYA à l'écran d'accueil puis ouvrir l'application installée.
3. Toucher la cloche dans la barre supérieure et autoriser les notifications.
4. Vérifier dans `GET /api/whatsapp/status` que `mobilePushSubscriptions` est supérieur à zéro.
5. Exécuter un test contrôlé avant de passer `SIGNELYA_NOTIFICATIONS_ENABLED=true`.

## Mise en service sûre

1. Déployer avec `SIGNELYA_NOTIFICATIONS_ENABLED=false`.
2. Valider les deux modèles Meta, le webhook, le SMTP et au moins un abonnement mobile Super Admin.
3. Renseigner le client test, son consentement WhatsApp et l'attribution du commercial.
4. Mettre l'écran test en ligne et vérifier son heartbeat.
5. Passer le commutateur à `true`, puis provoquer une perte contrôlée de heartbeat de plus de cinq minutes.
6. Vérifier les journaux de livraison e-mail, push et WhatsApp avant l'ouverture générale.
