# JS-Innov.IA Local Agent

Agent local Node.js qui sert de pont entre le cockpit JS-Innov.IA et les outils installés sur le PC :

- ComfyUI pour image, image-to-video, workflows IA ;
- Ollama pour prompts et assistant local ;
- FFmpeg pour assemblage et export vidéo.

## Installation

Depuis PowerShell :

```powershell
cd "C:\Users\PC User\Documents\Js-Innov.IA\js-innov.ia-cockpit"
npm run local-agent:install
npm run local-agent
```

L'agent démarre par défaut sur :

```text
http://127.0.0.1:8787
```

## Vérification

Ouvre dans le navigateur :

```text
http://127.0.0.1:8787/health
```

Ou depuis le cockpit :

```text
IA Locale > Tester la connexion
```

## Variables disponibles

Copier `local-agent/.env.example` vers `.env` si nécessaire, ou lancer PowerShell avec les variables suivantes :

```powershell
$env:LOCAL_AGENT_PORT="8787"
$env:COMFYUI_URL="http://127.0.0.1:8188"
$env:OLLAMA_URL="http://127.0.0.1:11434"
$env:LOCAL_PROJECTS_PATH="C:\Users\PC User\Documents\Js-Innov.IA"
npm run local-agent
```

## Endpoints principaux

```text
GET  /health
POST /projects/create
POST /prompts/dour-playa-plan
POST /ollama/generate
POST /comfy/prompt
POST /video/assemble
```

## Pipeline Dour Playa

1. Créer le projet local via le cockpit.
2. Placer la planche ADN dans `00_ADN_VISUEL`.
3. Placer l'audio final dans `01_AUDIO`.
4. Placer le storyboard dans `02_STORYBOARD`.
5. Générer le plan Dour Playa depuis `IA Locale`.
6. Envoyer les workflows image-to-video vers ComfyUI.
7. Assembler les clips avec FFmpeg.

## Notes importantes

L'agent local ne contient pas les modèles IA. Il pilote les moteurs installés sur ton PC. Les modèles ComfyUI/Wan/LTX/Ollama doivent être installés séparément.
