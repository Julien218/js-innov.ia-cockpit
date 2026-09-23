# Elynea Desktop — Qt Quick / QML

Elynea Desktop est le Companion Windows détaché du Cockpit. Le Cockpit web reste en React/Electron ; l'overlay permanent type Jarvis est rendu par Qt Quick / QML.

## Architecture

Cockpit React / Railway
        |
        | HTTPS
        v
Elynea Local Tools 127.0.0.1:8788 / 8787
        ^
        | HTTP local + Whisper
        |
Elynea Desktop QML

## Fonctionnalités

- fenêtre QML transparente, frameless et always-on-top ;
- mini-orbe Elynea repliable en bas à droite ;
- panneau conversationnel local ;
- dialogue avec l'agent Ollama local ;
- micro Windows capturé par Qt Multimedia ;
- transcription via le Whisper déjà exposé par Music Motion ;
- mode Appel Elynea : écoute par fenêtres courtes, détection du mot d'appel, puis commande ;
- synthèse vocale via Qt TextToSpeech lorsqu'elle est disponible ;
- lancement du Cockpit depuis le Companion ;
- démarrage automatique Windows via HKCU\Software\Microsoft\Windows\CurrentVersion\Run ;
- tentative de démarrage automatique de local-agent/server.js si Node est présent ;
- même avatar canonique Elynea que le Cockpit.

## Développement

Depuis elynea-qml sous Windows avec Python 3.12 :

1. py -3.12 -m venv .venv
2. .\.venv\Scripts\python.exe -m pip install -r requirements.txt
3. .\.venv\Scripts\python.exe main.py

## Build Windows

Exécuter build-windows.ps1, puis install-windows.ps1.

Le build embarque les sources de l'agent local afin qu'Elynea puisse le démarrer si le service n'est pas déjà disponible. Node reste requis pour exécuter l'agent local ; le poste JS-Innov.IA possède déjà cet environnement.

## Sécurité

Elynea Desktop ne publie aucun serveur réseau. Elle appelle uniquement l'agent local sur 127.0.0.1. Si LOCAL_AGENT_TOKEN est défini, il est envoyé comme Bearer token. Les opérations sensibles restent protégées par les garde-fous de l'agent local.

## Identité

Elynea reste l'unique Companion visible de JS-Innov.IA. Aucune identité NOVA distincte ni symbole plume n'est introduit.
