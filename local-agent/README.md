# JS-Innov.IA AI Factory Local v1

Service local-first pour le Cockpit. Il écoute uniquement sur `127.0.0.1:8787` et utilise Ollama localement.

## Démarrage

```bash
cd local-agent
npm install
npm start
```

Vérification: `GET http://127.0.0.1:8787/health`.

## Contrat v1

- `POST /architect/analyze`: analyse une demande et produit un plan structuré sans effet de bord.
- `GET /validations`: file de validation locale.
- `POST /validations/:id/approve`: validation humaine.
- `POST /validations/:id/reject`: refus humain.

## Sécurité

Le v1 n'exécute aucune écriture GitHub/Railway/Supabase/Dropbox. L'architecte marque les tâches à effet de bord `requires_approval=true`. L'exécution automatique ne sera ajoutée qu'après tests des permissions et des garde-fous. Le service est bindé sur loopback uniquement. Définir `LOCAL_AGENT_TOKEN` pour protéger les appels depuis le Cockpit.exe.

## Production locale

Ce composant doit être installé sur le PC qui exécute le Cockpit.exe/Ollama. Il ne doit pas être déployé sur Railway si Ollama reste sur le PC, car `127.0.0.1` de Railway désignerait le conteneur Railway et non le PC local.
