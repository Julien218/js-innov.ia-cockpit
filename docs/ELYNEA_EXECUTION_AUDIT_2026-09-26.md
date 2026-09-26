# Elynea — exécution et outils connectés

## Portée du lot

Correctifs ciblés du dialogue et de l'orchestration existants. Aucun changement de l'apparence du Cockpit, des autres applications, des secrets, des DNS ou des données métier. Aucun nouveau droit d'administration n'est accordé à l'agent.

## Changements implémentés

| Priorité | Modification | Limite à conserver visible |
| --- | --- | --- |
| Proposition → confirmation → exécution | Identifiant stable dès la proposition web ; reconnaissance des confirmations françaises ; contrôle de cible ; réservation avant envoi ; reçus de répétition sans réexpédier une action client. Journal local minimal, atomique et persistant pour les écritures Electron. | Le registre web reste en mémoire du processus, à durée limitée. Il ne constitue pas un registre transactionnel distribué. Une nouvelle proposition après redémarrage n'est pas dédupliquée globalement. |
| Contexte | Contrôle des identifiants de conversation/projet présents, sélection documentaire séparée par projet, rapports de tâches regroupés par organisation/projet/client, pas seulement par titre. | La reprise sémantique de toutes les demandes simultanées et le choix historique de tâche ne sont pas entièrement refondus. Un changement de sujet invalide encore la proposition précédente. Les appelants doivent transmettre le contexte. |
| Preuves | États observés distincts : queued, dispatched, failed, completed, unverified et reconciliation_required. Un compte rendu du navigateur n'est pas une preuve serveur. Les relances après issue réseau inconnue ne sont pas automatiques. | Les questions de suivi renvoient le dernier reçu horodaté, pas un nouveau polling du moteur. Aucun nouvel abonnement de notification n'est implémenté. |
| Image / animation / montage | Catégories de routage séparées ; demande locale explicite sans fallback cloud ; autorisation nécessaire pour un fallback payant. | La branche ComfyUI de cet exécuteur reste un contrôle de disponibilité. Elle ne soumet pas de workflow image et ne fabrique pas un montage multi-médias. Les entrées, fichiers produits et formats finaux restent à valider dans les exécuteurs de production. |
| Tests | 67 tests ciblés réussis dans l'environnement de travail Node 22.16.0. CI étendue pour exécuter ces tests, les régressions existantes et le build web. | Tests de middleware avec transport Express simulé, réponses de fournisseurs simulées et fichier local temporaire. Ce n'est pas une validation navigateur/Windows/GPU ni un rendu réel. Les résultats GitHub CI doivent être contrôlés séparément. |

## Outils de lecture réellement raccordés dans le code

Le runtime appelle les routes internes existantes en GET, sur une liste blanche, avec la session de l'utilisateur. Aucun jeton de service n'est transmis à ces lectures. Les contrôles d'accès des routes restent applicables.

- Emails IONOS configurés, hors alias ; comptes Google/Gmail actifs déjà connectés. Lecture des messages récents ou du jour, date Europe/Brussels, erreurs par boîte signalées. Cette commande n'envoie, ne classe, ne supprime et ne marque aucun email comme lu.
- Tâches, projets et factures du module facturation : lecture API, filtre de projet lorsqu'un identifiant est présent, résultats bornés. Un statut de fiche n'est pas une preuve de production terminée.
- Les outils existants de recherche/téléchargement documentaire Dropbox et de lecture GitHub sont conservés.

Les boîtes centrales sont restreintes au superadmin de l'organisation JS-Innov.IA avec permission emails, car les intégrations actuelles ne sont pas des connexions propres à chaque organisation cliente. Une adresse non connectée ne devient pas accessible grâce au seul routeur.

Limites de lecture : 100 emails récents maximum par compte, dix comptes Google maximum, 40 résultats affichés ; 100 enregistrements métier lus, 20 affichés. Pas de recherche exhaustive, pas de recherche email sur une période arbitraire, pas de filtrage métier avancé. Les sources et limites sont affichées dans la réponse.

## Protection contre les faux fallbacks

Une lecture connectée ou une confirmation serveur ne retombe plus silencieusement sur le modèle local après une erreur réseau. Le contenu d'un document ou d'un prompt ne choisit plus le connecteur Electron. Les champs d'action imbriqués peuvent toujours relever le niveau de risque. Les routes Calendar/Drive/Railway/Supabase reconnues ne sont pas présentées comme de nouveaux exécuteurs opérationnels : sans adaptateur, elles restent déléguées/non exécutées.

## Validation nécessaire avant mise en production

Contrôler la CI complète, puis une session authentifiée du Cockpit. Vérifier sur Windows la création du journal Electron, la confirmation orale transcrite et le retour d'exécution. Tester séparément une image locale, une animation avec référence contrôlée et un montage vertical final. Ouvrir réellement les fichiers finaux et valider les dimensions, l'intégrité et les références documentaires avant toute annonce de réussite.

Ce lot ne modifie ni les connexions OAuth ni les migrations de base. Le déploiement web et la diffusion d'une nouvelle version Electron sont des opérations distinctes. Aucun de ces statuts ne doit être déduit de la seule création d'une branche ou d'une pull request.
