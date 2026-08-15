# Passerelle caméra Pixelium — pilote

Cette passerelle s’exécute sur un PC ou mini-PC relié au même réseau local que les caméras. Les identifiants RTSP restent exclusivement dans `CAMERA_CONFIG_JSON` sur cette machine. Le cockpit ne reçoit que des images JPEG, des clips MP4 et des états de santé authentifiés par le jeton de passerelle.

Variables requises :

- `COCKPIT_URL`
- `GATEWAY_TOKEN`
- `CAMERA_CONFIG_JSON`, par exemple une liste d’objets avec `key` et `rtspUrl`

Variables facultatives : `SNAPSHOT_INTERVAL_SECONDS`, `RECORDING_ENABLED`, `RECORDING_DURATION_SECONDS`, `RECORDING_INTERVAL_SECONDS`.

Node.js 20+ et FFmpeg doivent être installés. Ne jamais envoyer le jeton ni les URL RTSP dans un message ou un dépôt GitHub.

