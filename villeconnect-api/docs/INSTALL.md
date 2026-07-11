# VilleConnect Copilot OS — Installation

## Prérequis
- Node.js >= 18.17
- Supabase (projet gfjpryakxzdzwnazlsfz — staging first)
- n8n instance avec webhooks configurés
- OpenAI API key

## 1. Cloner et configurer
```bash
cd villeconnect-api
cp .env.example .env.local
# Remplir .env.local avec les vraies valeurs (STAGING uniquement)
```

## 2. Installer les dépendances
```bash
npm install
```

## 3. Exécuter la migration SQL (STAGING uniquement — jamais prod sans validation PR)
```sql
-- Dans Supabase SQL Editor (staging) :
-- Copier-coller : migrations/001_villeconnect_schema_v2.sql
-- Rollback si besoin : migrations/001_rollback.sql
```

## 4. Tests
```bash
npm run typecheck   # Vérification TypeScript
npm run lint        # Lint ESLint
npm run test        # Tests unitaires Jest
npm run build       # Build production
```

## 5. Déploiement
```bash
# Railway (recommandé) :
railway up
# Ou Docker :
docker build -t villeconnect-api .
```

## 6. Machine d'états ai_action_logs
```
draft → pending_validation → approved → executing → succeeded
                           ↘ rejected              ↘ failed
                                                   ↘ cancelled
```
Transitions invalides rejetées par la fonction SQL `transition_action_status` (UPDATE WHERE status = from).

## 7. Sécurité webhook n8n
- HMAC-SHA256 (header X-N8N-Signature)
- Horodatage TTL 5min (header X-N8N-Timestamp)
- Idempotency-Key obligatoire (header + DB anti-rejeu)

## 8. Variables d'environnement requises
Voir `.env.example` — aucune valeur réelle dans ce fichier.
