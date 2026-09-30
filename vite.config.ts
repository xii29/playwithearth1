import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { lanAssets } from './scripts/lan-assets.mjs'
import { selectedPreload } from './scripts/selected-preload.mjs'

const certificatePath = fileURLToPath(new URL('./.cert/dev-cert.pem', import.meta.url))
const privateKeyPath = fileURLToPath(new URL('./.cert/dev-key.pem', import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [lanAssets(), selectedPreload()],
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', '@mediapipe/tasks-vision'] },
  server: {
    warmup: { clientFiles: ['./src/main.ts', './src/style.css'] },
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: command === 'serve'
      ? {
          cert: readFileSync(certificatePath),
          key: readFileSync(privateKeyPath),
        }
      : undefined,
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
}))
