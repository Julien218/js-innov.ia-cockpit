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
- ✅ Cockpit web toujours à jour, sans reconstruire le `.exe`
- ✅ Téléchargement automatique des nouvelles versions du programme à l'ouverture
- ✅ Installation automatique à la fermeture, sans retéléchargement manuel

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

La version `1.1.0` doit être installée une seule fois manuellement. À partir de
cette version, `electron-updater` télécharge les releases GitHub en arrière-plan
et les installe à la fermeture du cockpit.

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

