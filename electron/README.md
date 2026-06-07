# 🚀 JS-Innov.IA Cockpit — Application Desktop

Application Electron qui encapsule le cockpit web `cockpit.jsinnovia.com` en application native.

## 📦 Installation rapide

### Prérequis
- Node.js 18+ : https://nodejs.org

### Étapes

```bash
# 1. Cloner ce dossier
cd jsinnovia-cockpit-desktop

# 2. Installer les dépendances
npm install

# 3. Lancer l'app
npm start
```

## 🏗️ Compiler en installeur

```bash
# Windows (.exe installer)
npm run build:win

# Mac (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux
```

L'installeur sera généré dans le dossier `dist/`.

## 📝 Notes

- L'app charge `https://cockpit.jsinnovia.com` — connexion internet requise
- Les liens externes s'ouvrent dans votre navigateur par défaut
- **Julien AI** est accessible depuis la sidebar (section IA & Contrôle)

---
*🚀 JS-Innov.IA — Intelligence artificielle amplifiée par l'humain*

## 🏗️ Build automatique

Chaque push dans `electron/` déclenche automatiquement la compilation `.exe` (Windows) et `.dmg` (Mac) via GitHub Actions.
