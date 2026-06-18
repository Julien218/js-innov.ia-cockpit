# JS-Innov.IA Cockpit — App Desktop Windows

Application Electron qui charge le cockpit web `cockpit.jsinnovia.com` dans une fenêtre dédiée.

## Fonctionnalités

- ✅ Splash screen JS-Innov.IA au démarrage
- ✅ Tray icon (barre de tâches Windows)  
- ✅ Notifications Windows natives
- ✅ Raccourci bureau + menu Démarrer
- ✅ Fenêtre sans menu bar (propre)
- ✅ Liens externes → navigateur par défaut
- ✅ Installation silencieuse NSIS

## Installation (développement)

```bash
cd electron
npm install
npm start
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
- Windows (pour le build .exe)

## Structure

```
electron/
  main.js        ← Fenêtre principale, tray, notifications
  preload.js     ← Bridge sécurisé React ↔ Electron
  splash.html    ← Écran de démarrage
  package.json   ← Config build electron-builder
  icon.png       ← Icône app
```

## Connexion

Le cockpit charge **cockpit.jsinnovia.com** et se connecte directement à :
- **Supabase** `gfjpryakxzdzwnazlsfz` — données métier
- **NOVA** — IA centrale JS-Innov.IA

---
*JS-Innov.IA · Julien Pagin · Dour, Belgique*  
*"When Vision meets Intelligence."*

