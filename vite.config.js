import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

/**
 * Le dashboard historique reste monté pour conserver toutes ses fonctions
 * (upload, playlists, programmation, diagnostic), mais son ancien aperçu est
 * remplacé par SignelyaPriorityPlayer. Ce transform neutralise uniquement le
 * préchargement et l'autoplay de cet ancien aperçu caché afin qu'aucun média
 * ne soit demandé avant l'action explicite de l'utilisateur.
 */
function disableLegacySignelyaPreviewAutoload() {
  return {
    name: 'signelya-disable-legacy-preview-autoload',
    enforce: 'pre',
    transform(source, id) {
      const normalizedId = id.split('?')[0].replace(/\\/g, '/')
      if (!normalizedId.endsWith('/src/pages/DigitalSignage.jsx')) return null

      let code = source
      const initialPlaying = 'const [playing, setPlaying] = React.useState(true);'
      const initialPlayingReplacement = 'const [playing, setPlaying] = React.useState(false);'

      if (!code.includes(initialPlaying)) {
        this.error('SIGNELYA: état initial de l’ancien aperçu introuvable; arrêt du build pour éviter une régression autoplay.')
      }
      code = code.replace(initialPlaying, initialPlayingReplacement)

      const eagerDownloadEffect = /  React\.useEffect\(\(\) => \{\n    let cancelled = false;\n    setUrls\(\{\}\);\n    setErrors\(\{\}\);\n    Promise\.all\(items\.map\(async item => \{[\s\S]*?\n    return \(\) => \{ cancelled = true; \};\n  \}, \[clientEmail, itemKey\]\);/

      if (!eagerDownloadEffect.test(code)) {
        this.error('SIGNELYA: préchargement historique introuvable; arrêt du build pour éviter des téléchargements médias silencieux.')
      }
      code = code.replace(
        eagerDownloadEffect,
        '  React.useEffect(() => {\n    setUrls({});\n    setErrors({});\n  }, [clientEmail, itemKey]);',
      )

      const autoplayAttribute = /\n\s+autoPlay\n\s+muted=\{muted\}/
      if (!autoplayAttribute.test(code)) {
        this.error('SIGNELYA: attribut autoplay historique introuvable; arrêt du build pour éviter une régression.')
      }
      code = code.replace(autoplayAttribute, '\n              muted={muted}')

      return { code, map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [disableLegacySignelyaPreviewAutoload(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    allowedHosts: 'all',
  },
  preview: {
    allowedHosts: 'all',
  },
})
