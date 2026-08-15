# Passerelle caméra Pixelium — pilote

Cette passerelle s’exécute sur un PC ou mini-PC relié au même réseau local que les caméras. Les identifiants RTSP restent exclusivement dans `CAMERA_CONFIG_JSON` sur cette machine. Le cockpit ne reçoit que des images JPEG, des clips MP4 et des états de santé authentifiés par le jeton de passerelle.

## Installation Windows recommandée

1. Installez Node.js 20+ et FFmpeg sur le PC relié au réseau des caméras.
2. Ouvrez PowerShell dans ce dossier et lancez `./install-windows.ps1`.
3. Saisissez le jeton affiché une seule fois dans le cockpit, puis l’URL RTSP de la caméra. Les deux saisies restent masquées.
4. Le script chiffre ces secrets pour l’utilisateur Windows courant et démarre automatiquement la passerelle à chaque ouverture de session.

Le statut doit passer à **En ligne** dans le cockpit en moins d’une minute. Le fichier `%LOCALAPPDATA%/PixeliumCameraGateway/gateway.log` contient uniquement les diagnostics nettoyés. Utilisez `./uninstall-windows.ps1` pour retirer la tâche de démarrage et les fichiers locaux.

## Installation manuelle

Variables requises :

- `COCKPIT_URL`
- `GATEWAY_TOKEN`
- `CAMERA_CONFIG_JSON`, par exemple une liste d’objets avec `key` et `rtspUrl`

Variables facultatives : `SNAPSHOT_INTERVAL_SECONDS`, `RECORDING_ENABLED`, `RECORDING_DURATION_SECONDS`, `RECORDING_INTERVAL_SECONDS`.

Node.js 20+ et FFmpeg doivent être installés. Ne jamais envoyer le jeton ni les URL RTSP dans un message ou un dépôt GitHub.

