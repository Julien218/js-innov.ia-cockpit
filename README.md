**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file and set the right environment variables

```
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url

e.g.
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

Run the app: `npm run dev`

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)

## Configuration serveur du cockpit

Les accès privilégiés ne doivent jamais utiliser de variable `VITE_*`. Configurez uniquement sur le service serveur :

```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=<clé secrète serveur Supabase>
JSINNOVIA_AGENT_URL=https://<service-agent>
JSINNOVIA_AGENT_KEY=<clé serveur de l'agent>
COCKPIT_URL=https://cockpit.jsinnovia.com
```

`SUPABASE_SERVICE_ROLE_KEY` reste accepté pendant la migration vers les nouvelles clés secrètes Supabase. Supprimez les anciennes variables `VITE_AGENT_KEY`, `VITE_AGENT_AUTH`, `VITE_AGENT_API_KEY` et `VITE_AGENT_URL` de la configuration de build après déploiement de cette version.

L'assistant personnel est disponible sur `/agent`. Il utilise la session HttpOnly du cockpit, limite le débit, sépare les conversations par utilisateur et exige une confirmation pour toute action autorisée. Chaque conversation et action est journalisée dans `LogAction`.
