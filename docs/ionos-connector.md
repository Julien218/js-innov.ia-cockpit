# IONOS dans NOVA ELYNEA

Installation serveur : `/api/ionos/status`, `/api/ionos/read` et interception des demandes
IONOS dans `/api/assistant/chat`. Interface dans **Domaines → IONOS · NOVA ELYNEA**.
L'inventaire du compte est réservé au rôle `superadmin`, sans accès depuis Elynea publique
ni depuis les comptes clients ou collaborateurs. Aucune nouvelle permission d'écriture.

Dans Railway, projet NOVA V2, service cockpit-v3, environnement production :

- Ajouter `IONOS_PAT`, PAT du [portail MCP IONOS](https://developer.hosting.ionos.com/mcp),
  avec uniquement `ionos:domain:hosting::domain/read`, `ionos:domain:hosting::dns/read`,
  `ionos:server:hosting::corevps/read`, `ionos:server:hosting::dedicatedserver/read`.
- Facultatif : `IONOS_CLOUD_TOKEN`, valeur du token créé dans DCD → Management → Token Manager.
- Ne jamais préfixer ces variables par VITE_, ni les placer dans un fichier client.
- Appliquer les variables dans Railway pour qu'elles soient disponibles au prochain déploiement.

Le panneau distingue « identifiant configuré » de « consultation vérifiée ». Une clé absente produit
une erreur explicite et n'empêche pas le cockpit de démarrer. Vérifier avec « Liste mes domaines IONOS ».
Le catalogue de lectures est figé dans `ionos-read-tools.json`, adapté du catalogue public officiel
vérifié le 12 septembre 2026. Les requêtes MCP passent par le SDK officiel vers `https://mcp.ionos.com/mcp` ;
Public Cloud utilise GET vers `https://api.ionos.com/cloudapi/v6`.

Les domaines et Public Cloud ont une pagination explicite. Les vues VPS/dédiés commencent par les contrats.
La mémoire et les CPU du Cloud sont des ressources configurées, pas des métriques d'utilisation.
Les autres consultations du catalogue (pare-feu, IP, alarmes, sauvegardes) sont disponibles via l'API privée
avec le nom d'outil et ses paramètres, sans interface de modification.

Tests : `node --test tests/ionos-connector.test.cjs`, `npm test`, `npm run build`.
Les tests IONOS simulent les réponses distantes ; une vérification réelle nécessite le PAT du propriétaire.
Le connecteur DNS historique `server-ionos-dns.cjs` et ses confirmations restent séparés.
