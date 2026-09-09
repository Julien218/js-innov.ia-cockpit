# JS-Innov.IA AI Factory Local v1

Service local-first pour le Cockpit. Il écoute uniquement sur `127.0.0.1:8787` et utilise Ollama localement.

## Démarrage

```bash
cd local-agent
npm install
npm start
```

Vérification: `GET http://127.0.0.1:8787/health`.

## Contrat v1.1

- `POST /api/agent/chat`: conversation NOVA locale et détection déterministe des outils autorisés.
- `GET /api/tools`: capacités réellement mesurées et dossiers autorisés.
- `POST /api/tools/execute`: exécution d’un outil en liste blanche.
- `GET /api/tools/runs/:id`: preuve d’exécution en mémoire.
- `POST /architect/analyze`: analyse une demande et produit un plan structuré sans effet de bord.
- `GET /validations`: file de validation locale.
- `POST /validations/:id/approve`: validation humaine.
- `POST /validations/:id/reject`: refus humain.

## Sécurité

Les seuls outils exécutables sont `ffmpeg_version`, `ffprobe_file` et `list_directory`. Ils utilisent `execFile` sans shell. Les chemins doivent appartenir à `LOCAL_AGENT_ALLOWED_ROOTS` (sinon Downloads, Documents et Videos). Chaque appel produit heure, code de sortie, sortie brute et identifiant dans `%LOCALAPPDATA%\JS-InnovIA\AI-Factory\tool-runs.jsonl`. Aucune écriture GitHub/Railway/Supabase/Dropbox, suppression ou commande libre n'est acceptée.

## Production locale

La version Electron 1.0.19 embarque et démarre ce composant automatiquement. Si un ancien agent occupe déjà 8787, le moteur embarqué démarre sur 8788 et NOVA le privilégie. Il ne doit pas être déployé sur Railway : Ollama et les outils restent sur le PC.


## Analyse musicale — Elynea Music Motion Studio

Le point POST /api/music-motion/analyze reçoit une chanson encodée localement, la transcrit avec faster-whisper et transmet uniquement le texte et les timecodes à Ollama pour construire un plan de réalisation. Le fichier audio temporaire est supprimé après l’analyse.

Installation optionnelle sous Windows :

    powershell -ExecutionPolicy Bypass -File .\install-music-motion-windows.ps1

ou, manuellement :

    python -m pip install -r .\requirements-music-motion.txt

Variables utiles dans .env :

- MUSIC_MOTION_PYTHON : interpréteur Python à utiliser ;
- MUSIC_MOTION_WHISPER_MODEL : modèle, par défaut small ;
- MUSIC_MOTION_WHISPER_DEVICE : cuda ou cpu ;
- MUSIC_MOTION_WHISPER_COMPUTE_TYPE : par défaut int8 ;
- MUSIC_MOTION_WHISPER_LANGUAGE : par défaut fr.

Si Whisper ou librosa n’est pas installé, l’interface signale précisément le service manquant et conserve une timeline modifiable de secours.
