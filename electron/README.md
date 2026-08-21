# JS-Innov.IA Cockpit — App Desktop Windows

Application Electron qui charge le Cockpit web `cockpit.jsinnovia.com` dans une fenêtre dédiée.

## Fonctionnalités

- ✅ Splash screen JS-Innov.IA au démarrage
- ✅ Tray icon Windows
- ✅ Notifications Windows natives
- ✅ Raccourci bureau + menu Démarrer
- ✅ Fenêtre sans menu bar
- ✅ Liens externes → navigateur par défaut
- ✅ Installation NSIS one-click
- ✅ Bridge local ComfyUI sur `127.0.0.1:8188`
- ✅ Mise à jour globale du Cockpit web au démarrage : purge du cache HTTP uniquement, sans déconnexion
- ✅ Mise à jour automatique de l'application Electron via GitHub Releases

## Politique de mise à jour

Le Cockpit web reste la source de vérité de l'interface. À chaque démarrage du `.exe`, le cache HTTP Electron est vidé avant le chargement de `cockpit.jsinnovia.com`. Les cookies, la session et le stockage utilisateur ne sont pas effacés. Une évolution d'un module web ne nécessite donc pas un nouveau bouton de rechargement par module.

L'enveloppe Electron est versionnée séparément. Lorsqu'une nouvelle release Windows est publiée, l'application :

1. vérifie la dernière version au démarrage ;
2. télécharge automatiquement l'installeur si nécessaire ;
3. redémarre automatiquement pour l'installer ;
4. relance le Cockpit après installation.

Les releases doivent contenir l'installeur `.exe`, son `.blockmap` et `latest.yml`, utilisés par `electron-updater`.

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

Le fichier `.exe` sera généré dans `electron/dist/`.

## Prérequis

- Node.js 18+
- npm
- Windows pour le build natif `.exe`

## Structure

```text
electron/
  bootstrap.js   ← refresh global + auto-update Electron
  main.js        ← fenêtre principale, tray, notifications, bridge local
  preload.js     ← bridge sécurisé React ↔ Electron
  splash.html    ← écran de démarrage
  package.json   ← configuration electron-builder / updater
  icon.png       ← icône app
```

## Connexion

Le Cockpit charge `cockpit.jsinnovia.com`. Les secrets restent côté serveur ou dans les services locaux dédiés ; l'enveloppe Electron n'embarque pas de clé fournisseur dans son code source.

---
JS-Innov.IA · Dour, Belgique
