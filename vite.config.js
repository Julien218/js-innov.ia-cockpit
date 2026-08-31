import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { publicEnvDefinitions } from './scripts/public-env.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // No automatic VITE_* exposure. Only explicitly public settings reach the browser.
  envPrefix: '__COCKPIT_PUBLIC_UNUSED_PREFIX__',
  define: publicEnvDefinitions(loadEnv(mode, process.cwd(), 'VITE_')),
  plugins: [react()],
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
}))
