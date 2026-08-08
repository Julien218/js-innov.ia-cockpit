# JS-Innov.IA Cockpit — App Desktop Windows

Application Electron qui charge le cockpit web `cockpit.jsinnovia.com` dans une fenêtre dédiée.

## Fonctionnalités

- ✅ Splash screen JS-Innov.IA au démarrage
- ✅ Tray icon (barre de tâches Windows)
- ✅ Notifications Windows natives
- ✅ Raccourci bureau + menu Démarrer
- ✅ Fenêtre sans menu bar
- ✅ Liens externes → navigateur par défaut
- ✅ Installation NSIS
- ✅ Configuration persistante de l'agent local
- ✅ Clé API locale chiffrée avec Electron `safeStorage` (DPAPI sous Windows)

## Agent local

Le Cockpit Desktop possède un coffre local dédié à la connexion de l'agent local.

Configuration par défaut :

```text
http://127.0.0.1:8787
```

Au premier lancement sans clé enregistrée, la fenêtre **Agent local** s'ouvre automatiquement. Elle est également disponible depuis l'icône du Cockpit dans la zone de notification Windows :

**Configurer l'agent local**

La clé :

- n'est pas enregistrée dans le stockage du navigateur ;
- n'est pas envoyée à GitHub ou Railway ;
- n'est jamais renvoyée en clair au cockpit web ;
- est chiffrée par le système d'exploitation via `safeStorage` ;
- est conservée dans le dossier `userData` Electron sous forme chiffrée ;
- reste disponible après fermeture et redémarrage du `.exe`.

Le bouton **Tester l'agent** vérifie la disponibilité du service local via `/health`.

## Installation (développement)

```bash
cd electron
npm install
npm start
```

## Vérification

```bash
cd electron
npm run check
```

## Build .exe (Windows)

```bash
cd electron
npm install
npm run build:win
```

Le fichier `.exe` sera dans `electron/dist/`.

## Prérequis

- Node.js 18+
- npm ou yarn
- Windows pour le build `.exe` Windows

## Structure

```text
electron/
  main.js                ← Fenêtre principale, coffre sécurisé, tray, notifications
  preload.js             ← Bridge sécurisé React ↔ Electron
  splash.html            ← Écran de démarrage
  agent-settings.html    ← Configuration chiffrée de l'agent local
  package.json           ← Config build electron-builder
  icon.png               ← Icône app
```

## Connexion

Le cockpit charge **cockpit.jsinnovia.com** et se connecte aux services JS-Innov.IA configurés. La configuration locale de l'agent est volontairement séparée des secrets cloud.

---
*JS-Innov.IA · Dour, Belgique*
