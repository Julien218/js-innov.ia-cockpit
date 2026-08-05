# Guide Multi-Marques (Multi-Brand Architecture)

Ce document explique l'architecture multi-marques du **Email Core Framework**, le fonctionnement du pilotage par les données (*data-driven*) et la procédure pour ajouter de nouvelles marques sans modifier une seule ligne de code.

---

## 🎯 Principes d'Architecture Data-Driven

Historiquement, la gestion de plusieurs adresses d'expédition ou boîtes d'envoi reposait sur des conditions `if/else` ou des blocs `switch(brand)` codés en dur dans les contrôleurs Express.

Dans la version 1.0.0, l'architecture est intégralement **Data-Driven** :
- **Table pivot `email_brands` :** Toutes les métadonnées de la marque (nom, adresse d'expédition, signature, couleurs, hôte SMTP) sont stockées en base de données.
- **Résolution dynamique au runtime :** Lorsqu'une requête arrive (`brand_code: "assurances"`), le service charge la configuration depuis PostgreSQL / Supabase ou depuis un cache LRU mémoire de 5 minutes.
- **Zéro déploiement de code :** L'ajout, la modification ou la désactivation d'une marque s'effectue par de simples requêtes SQL ou via le panneau d'administration Cockpit.

---

## 🏬 Liste des 7 Marques Actuelles

L'écosystème **JS-Innov.IA Cockpit** gère 7 marques distinctes :

| Code Marque (`brand_code`) | Nom Officiel | Email d'Expédition (`from`) | Serveur SMTP | Couleur Thème |
| :--- | :--- | :--- | :--- | :--- |
| **`jsinnovia`** | JS-Innov.IA Core | `info@jsinnovia.com` | IONOS (`smtp.ionos.fr:465`) | `#D4AF37` (Or) |
| **`assurances`** | Assurances Dour | `info@assurances-dour.be` | IONOS (`smtp.ionos.fr:465`) | `#06B6D4` (Cyan) |
| **`store`** | JS-Innov.IA Store | `info@jsinnovia.store` | IONOS (`smtp.ionos.fr:465`) | `#7C3AED` (Violet) |
| **`villeconnect`** | VilleConnect / Copilot OS | `contact@villeconnect.be` | Dedicated Override | `#10B981` (Émeraude) |
| **`letourdedour`** | Le Tour de Dour | `contact@letourdedour.com` | Shared IONOS | `#F59E0B` (Ambre) |
| **`synergiedour`** | Synergie Dour | `contact@synergiedour.be` | Shared IONOS | `#3B82F6` (Bleu) |
| **`fashionistart`** | Miss & Mister Dour / Fashionist'ART | `contact@missetmisterdour.be` | Shared IONOS | `#EC4899` (Rose) |

---

## 📧 Configuration SMTP par Marque (Default vs Override)

### 1. Transport IONOS Par Défaut
Par défaut, si la colonne `smtp_override` est `NULL`, le service utilise la configuration serveur IONOS commune :
- **Hôte SMTP :** `smtp.ionos.fr`
- **Port :** `465` (SSL/TLS direct)
- **Authentification :** `EMAIL_<BRAND>_ADDRESS` et `EMAIL_PASSWORD_<BRAND>` extraits des variables d'environnement.

### 2. Surcharge SMTP Personnalisée (`smtp_override`)
Si une marque nécessite son propre serveur SMTP dédié (ex: SendGrid, Amazon SES, Mailgun, ou un serveur de commune pour VilleConnect), il suffit de renseigner la colonne `smtp_override` au format JSONB :

```json
{
  "host": "smtp.sendgrid.net",
  "port": 587,
  "secure": false,
  "auth": {
    "user": "apikey",
    "pass": "SG.your_sendgrid_api_key_here"
  },
  "tls": {
    "rejectUnauthorized": true
  }
}
```

---

## 🎨 Templates & Signatures HTML par Marque

### 1. Signatures Institutionnelles
La colonne `html_signature` de la table `email_brands` permet de définir le pied de page HTML automatique pour tous les courriels émis sous cette marque.

Exemple pour Assurances Dour :
```html
<div style="margin-top: 20px; border-top: 1px solid #e5e7eb; pt: 15px; font-family: sans-serif; font-size: 12px; color: #4b5563;">
  <p><strong>Cabinet Assurances Dour</strong> — Courtage & Conseils</p>
  <p>📍 Rue de Grand-Mère 12, 7370 Dour | 📞 +32 65 00 00 00</p>
  <p><a href="https://assurances-dour.be" style="color: #06B6D4;">www.assurances-dour.be</a></p>
</div>
```

### 2. Isolation des Templates par Marque
Les templates d'emails (`email_templates`) sont rattachés à un `brand_id`. Une marque ne peut pas utiliser par erreur le template d'une autre marque.

---

## ➕ Procédure : Comment Ajouter une Nouvelle Marque (Sans Code)

Pour ajouter une 8ème marque (ex: `innovia-health` / `contact@innovia-health.be`) :

### Étape 1 : Insérer la marque dans PostgreSQL

Exécuter la requête SQL suivante dans Supabase :

```sql
INSERT INTO public.email_brands (
  code, 
  name, 
  default_from_email, 
  default_from_name, 
  theme_config, 
  html_signature
) VALUES (
  'innovia-health',
  'Innov.IA Health Care',
  'contact@innovia-health.be',
  'Innov.IA Health',
  '{"primary_color": "#14B8A6", "logo_url": "https://innovia-health.be/logo.png"}',
  '<p style="font-family:sans-serif; color:#14B8A6;"><strong>Innov.IA Health</strong> — Technologies de Santé</p>'
);
```

### Étape 2 : Définir le mot de passe SMTP (si transport IONOS shared)

Ajouter la variable d'environnement sur Railway / Serveur Backend :
```bash
EMAIL_PASSWORD_INNOVIA_HEALTH=votre_mot_de_passe_smtp
```

### Étape 3 : Tester l'envoi immédiat

Appeler l'API `/api/emails/send` :

```bash
curl -X POST https://cockpit.jsinnovia.com/api/emails/send \
  -H "Content-Type: application/json" \
  -H "x-agent-key: $EMAIL_PROXY_KEY" \
  -d '{
    "brand_code": "innovia-health",
    "to": "test@example.com",
    "subject": "Test nouvelle marque",
    "text": "Bienvenue sur Innov.IA Health !"
  }'
```

Le service chargera automatiquement la nouvelle marque et expédiera le courriel sans nécessiter aucun redéploiement applicatif.
