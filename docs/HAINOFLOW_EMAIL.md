# Intégration HainoFlow — Email officiel

## Contrat

Endpoint :

```text
POST https://cockpit.jsinnovia.com/api/emails/official
```

En-têtes :

```text
Content-Type: application/json
x-agent-key: <EMAIL_PROXY_KEY>
Idempotency-Key: <identifiant unique>
```

Le secret HainoFlow doit correspondre à `EMAIL_PROXY_KEY` côté Cockpit et rester distinct de `AGENT_API_KEY`.

## Payload accepté

```json
{
  "to": ["recipient@example.com"],
  "cc": ["copy@example.com"],
  "bcc": [],
  "subject": "Objet obligatoire",
  "text": "Contenu texte",
  "html": "<p>Contenu HTML optionnel</p>",
  "replyTo": "reply@example.com",
  "metadata": {
    "source": "hainoflow",
    "documentType": "invoice"
  }
}
```

Contraintes actuelles :

- `to` obligatoire ;
- `subject` obligatoire ;
- au moins `text` ou `html` ;
- vingt destinataires maximum au total ;
- `from` et `mailbox` refusés ;
- cinq champs `metadata` maximum ;
- corps limité à 500 000 octets ;
- `Idempotency-Key` de 8 à 128 caractères alphanumériques, tirets ou underscores.

## Réponses attendues

| Code | Signification |
|---:|---|
| 200 | email envoyé ou replay idempotent |
| 400 | payload ou en-tête invalide |
| 401 | clé absente ou incorrecte |
| 409 | conflit d’idempotence ou requête concurrente |
| 429 | limitation de débit |
| 502 | échec SMTP |
| 503 | `EMAIL_PROXY_KEY` absente du serveur |

## Idempotence

HainoFlow doit générer une clé stable par intention d’envoi. Un retry technique du même email réutilise la même clé et le même payload. Une nouvelle action métier doit utiliser une nouvelle clé.

Exemples recommandés :

```text
invoice_<invoice-id>_<version>
quote_<quote-id>_<version>
notification_<event-id>
```

La persistance actuelle est en mémoire pendant une heure. Elle protège une instance unique, mais ne suffit pas encore pour plusieurs réplicas ou un redémarrage.

## Configuration

Côté Cockpit Railway :

```text
EMAIL_PROXY_KEY=<secret aléatoire serveur>
EMAIL_STORE_ADDRESS=<adresse officielle>
EMAIL_PASSWORD_STORE=<mot de passe SMTP>
```

Côté HainoFlow :

```text
URL_PROXY_EMAIL=https://cockpit.jsinnovia.com
CLE_PROXY_EMAIL=<même valeur que EMAIL_PROXY_KEY>
```

Aucune valeur secrète ne doit apparaître dans GitHub, les logs, les tickets ou les messages de support.

## Test de validation

1. `GET /api/health` retourne 200 ;
2. une mauvaise clé retourne 401 ;
3. l’absence d’`Idempotency-Key` retourne 400 ;
4. un envoi valide retourne 200 et un `messageId` ;
5. le replay identique retourne 200 avec le même `messageId` ;
6. un seul email est reçu.

## Évolutions requises

- journalisation persistante ;
- queue et retries exponentiels ;
- dead-letter queue ;
- clé dédiée par application ;
- pièces jointes validées ;
- métriques et alertes ;
- persistance de l’idempotence PostgreSQL ou Redis.
