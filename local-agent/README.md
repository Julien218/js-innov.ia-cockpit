# JS-Innov.IA — Agent local Elynea 1.5.0

Service local-first du Cockpit JS-Innov.IA. L’agent principal écoute normalement sur `127.0.0.1:8787`. Le Cockpit Music Motion recherche d’abord `8788`, puis `8787`, afin qu’une ancienne instance puisse rester temporairement en place sans bloquer la migration.

Les services Avatar Factory `8791`, `8792` et `8793` sont indépendants et ne doivent pas être confondus avec l’agent Music Motion.

## Installation / réparation Windows recommandée

Depuis le dossier `local-agent` :

```powershell
powershell -ExecutionPolicy Bypass -File .\repair-music-motion-windows.ps1
```

Le réparateur :

- inventorie les processus sur `8787` et `8788` ;
- ne touche jamais aux services Avatar Factory `8791–8793` ;
- met à niveau les dépendances Node ;
- crée un environnement Python isolé `.venv-music-motion` ;
- installe la pile Music Motion (NumPy, SciPy, librosa, faster-whisper, pypdf) ;
- remplace uniquement une ancienne instance JS-Innov.IA identifiable sur `8788` ;
- démarre l’agent actuel sur `8788` ;
- vérifie réellement `GET /api/music-motion/production/capabilities` ;
- installe le démarrage automatique Windows.

## Vérifications

Agent général :

```text
GET http://127.0.0.1:8788/health
GET http://127.0.0.1:8787/health
```

Music Motion v2 :

```text
GET http://127.0.0.1:8788/api/music-motion/production/capabilities
GET http://127.0.0.1:8787/api/music-motion/production/capabilities
```

Le Cockpit considère l’agent Music Motion disponible dès qu’un des deux ports répond avec le contrat `version: 2`.

## Capacités principales

- conversation Elynea locale et orchestration d’outils autorisés ;
- FFmpeg / FFprobe ;
- analyse audio Music Motion v2 ;
- transcription locale via faster-whisper lorsque disponible ;
- lecture de PDF locale ;
- intégration ComfyUI locale ;
- télémétrie locale CPU/GPU/coût technique ;
- validation humaine des actions sensibles.

## Sécurité

L’agent n’écoute que sur la boucle locale (`127.0.0.1`). Les outils système sont limités et les chemins doivent appartenir aux racines autorisées. Aucune commande shell arbitraire n’est exposée par l’API.

Les variables principales se trouvent dans `.env.example`, notamment :

- `LOCAL_AGENT_PORT` ;
- `LOCAL_AGENT_TOKEN` ;
- `MUSIC_MOTION_PYTHON` ;
- `MUSIC_MOTION_WHISPER_MODEL` ;
- `MUSIC_MOTION_WHISPER_DEVICE` ;
- `MUSIC_MOTION_WHISPER_COMPUTE_TYPE` ;
- `MUSIC_MOTION_WHISPER_LANGUAGE` ;
- `COMFYUI_URL` ;
- `OLLAMA_URL`.
