# Modèle de Sécurité & Conformité (Security Model)

Ce document décrit la stratégie de sécurité en profondeur (*Defense in Depth*) appliquée au **Email Core Framework** du Cockpit JS-Innov.IA.

---

## 🔒 1. Double Architecture d'Authentification

Pour garantir l'étanchéité entre les utilisateurs de l'IHM Cockpit et les appels automatisés externes, le service met en oeuvre deux mécanismes distincts :

```
                                  ┌─────────────────────────────┐
                                  │      Client Navigateur      │
                                  │     (Cockpit v3 React)      │
                                  └──────────────┬──────────────┘
                                                 │ Cookie HttpOnly (Session)
                                                 ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│    Robots / Agents / n8n    │   │  Middleware requireSession  │
│   (Appels Machine-to-Machine)│   └──────────────┬──────────────┘
└──────────────┬──────────────┘                  │
               │ Header x-agent-key              │
               ▼                                 │
┌─────────────────────────────┐                  │
│ Middleware requireApiKey /  │                  │
│   requireOfficialApiKey     │                  │
└──────────────┬──────────────┘                  │
               │                                 │
               └────────────────┬────────────────┘
                                │
                                ▼
                   ┌──────────────────────────┐
                   │ Express Email Core API   │
                   └──────────────────────────┘
```

### A. Sessions Navigateur HttpOnly (`requireSession`)
- Utilisé pour toutes les interactions IHM dans Cockpit v3.
- Les jetons de session sont stockés dans des cookies `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Zéro clé API ou secret SMTP n'est exposé au code JavaScript côté client (frontend).**

### B. Clé API Dédicacée Machine-to-Machine (`EMAIL_PROXY_KEY`)
- Utilisé pour les appels automatisés (ex: n8n, microservices, agents IA).
- Exige la clé transmise exclusivement dans le header HTTP `x-agent-key`.
- **Comparaison sécurisée en temps constant :** La vérification de la clé utilise la fonction `crypto.timingSafeEqual` sur des hachages SHA-256 pour prévenir les attaques par canal auxiliaire de type *Timing Attacks* :

```javascript
function safeCompareHashes(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
```

- **Rejet strict des query strings :** Si une clé d'API est transmise en paramètre d'URL (ex: `/api/emails/official?key=...`), la requête est immédiatement rejetée avec un code `401 Unauthorized`. Les clés ne doivent jamais figurer dans les journaux d'accès HTTP / URL proxy.

---

## 🛡️ 2. Isolation des Données & Supabase RLS

La couche de persistance Supabase PostgreSQL applique le modèle **Row Level Security (RLS)** :
- Les opérations de modification, d'insertion en file d'attente et de lecture des mots de passe SMTP sont strictement réservées au rôle `service_role`.
- Le client frontend React ne possède pas de droits d'écriture directe sur les tables `email_queue` ou `email_brands`.
- Les identifiants SMTP (mots de passe) stockés en variables d'environnement ne sont jamais transmis aux réponses JSON des API.

---

## 🌐 3. Middleware `requireSameOrigin` & Protection Anti-CSRF

Pour parer aux attaques par falsification de requête intersites (CSRF) sur les endpoints modificateurs d'état (`POST`, `PUT`, `DELETE`) déclenchés depuis le navigateur :
- Le middleware `requireSameOrigin` contrôle la présence et la conformité des headers `Origin` et `Referer`.
- Les requêtes cross-origin non autorisées sont rejetées avec un statut `403 Forbidden`.

---

## 🧼 4. Validation des Saisies & Prévention d'Injections

Toute requête entrante subit un contrôle strict du schéma avant d'atteindre la couche métier ou la base de données :

1. **Validation des Adresses Email (RFC 5322) :** Vérification par expression régulière. Refus des injections d'en-tête (ex: saut de ligne `\r\n` dans le sujet ou l'adresse destinataire pour prévenir le *Header Injection*).
2. **Limites de Taille des Payloads :**
   - Sujet (`subject`) : Maximum **200 caractères**.
   - Corps du message (`text` / `html`) : Maximum **500 KB**.
   - Nombre de destinataires (`to`, `cc`, `bcc`) : Maximum **20 adresses** par envoi.
   - Métadonnées (`metadata`) : Maximum **5 clés**, longueur max des valeurs **500 caractères**.

---

## 🔁 5. Idempotence & Protection Anti-Replay

Afin de neutraliser les attaques par rejeu ou les surcharges accidentelles :
- Chaque requête d'envoi peut fournir un header `Idempotency-Key` (obligatoire sur `/official`).
- La clé est enregistrée de manière atomique dans la base de données.
- Les requêtes simultanées partageant la même clé pendant la phase d'exécution sont bloquées avec une erreur `409 Conflict`.

---

## 📜 6. Traçabilité & Journalisation Immuable (`EmailLog`)

Toutes les opérations d'envoi font l'objet d'un enregistrement dans la table `email_logs` :
- **Audit Append-Only :** La table `email_logs` ne supporte pas la suppression ou la modification par les utilisateurs standards.
- **Détails enregistrés :** Adresse expéditrice, adresse destinataire, horodatage exact, réponse brute du serveur SMTP (`250 OK`), identifiant de message SMTP, statut et durée d'envoi.
- **Masquage des données sensibles :** Aucune clé d'API, aucun mot de passe ou jeton de session n'est jamais écrit dans les journaux d'erreurs console ou dans la table `email_logs`.
