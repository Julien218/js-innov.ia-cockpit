# Intégration IA Locale — notes techniques

Branche : `feature/local-ai-agent`

## Déjà ajouté

- `local-agent/server.js` : serveur local Node.js.
- `local-agent/package.json` : dépendances et script de lancement.
- `local-agent/README.md` : guide PowerShell.
- `local-agent/.env.example` : configuration locale.
- `src/services/localAiClient.js` : client HTTP côté cockpit.
- `src/pages/LocalAI.jsx` : page cockpit IA Locale.
- `package.json` : scripts `local-agent:install` et `local-agent`.
- `src/App.jsx` : route `/local-ai`.

## À finaliser dans le cockpit

Le contrôle d'accès actuel du cockpit repose sur `src/lib/roles.js` et `src/components/ProtectedRoute.jsx`.

Pour afficher et autoriser `/local-ai`, ajouter `/local-ai` aux routes `superadmin` et `admin`, puis ajouter une entrée de menu dans `src/components/layout/Sidebar.jsx`.

### Modification attendue dans `src/lib/roles.js`

Ajouter `/local-ai` dans :

```js
superadmin: [
  "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
  "/services", "/devis", "/factures", "/commissions",
  "/validations", "/logs", "/agent", "/agents-ia", "/local-ai", "/invitations"
],
admin: [
  "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
  "/services", "/devis", "/factures", "/commissions",
  "/validations", "/agent", "/agents-ia", "/local-ai", "/invitations"
],
```

### Modification attendue dans `src/components/layout/Sidebar.jsx`

Ajouter `Cpu` dans l'import `lucide-react` :

```js
Bot, Cpu, Network, UserPlus, LogOut
```

Puis ajouter l'entrée dans le groupe `IA & Contrôle` :

```js
{ label: "IA Locale", icon: Cpu, path: "/local-ai", minRole: "admin" },
```

## Lancement local

```powershell
cd "C:\Users\PC User\Documents\Js-Innov.IA\js-innov.ia-cockpit"
npm install
npm run local-agent:install
npm run local-agent
```

Dans un deuxième terminal :

```powershell
npm run dev
```

Puis ouvrir :

```text
http://localhost:5173/local-ai
```

## Services attendus

- ComfyUI : `http://127.0.0.1:8188`
- Ollama : `http://127.0.0.1:11434`
- Agent local : `http://127.0.0.1:8787`
