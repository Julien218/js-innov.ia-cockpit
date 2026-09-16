# Elynea — tous fichiers vers Dropbox

Le trombone Elynea accepte les fichiers sans filtre d’extension côté interface.

Le serveur :
- borne chaque fichier à 100 MiB ;
- neutralise le nom avant construction du chemin Dropbox ;
- classe par client, projet et catégorie quand le contexte permet une correspondance fiable ;
- place sinon le fichier sous `A_Classer` ;
- indexe le fichier dans `DocumentIndex` afin qu’il apparaisse dans le Centre Documents ;
- permet le téléchargement via la session Cockpit ;
- ne crée aucun lien Dropbox public ;
- n’exécute jamais le contenu d’un fichier déposé.

Les aperçus intégrés restent réservés aux médias reconnus ; un fichier générique est stocké et téléchargeable sans interprétation automatique.
