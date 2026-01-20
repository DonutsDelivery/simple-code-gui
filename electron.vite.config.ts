import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import fs from 'fs'

// Plugin to serve whisper-web-transcriber files (needed for dynamic script loading)
function serveWhisperFiles() {
  return {
    name: 'serve-whisper-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/node_modules/whisper-web-transcriber/')) {
          const filePath = resolve(__dirname, req.url.slice(1))
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath)
            const ext = filePath.split('.').pop()
            const mimeTypes: Record<string, string> = {
              'js': 'application/javascript',
              'wasm': 'application/wasm'
            }
            const mimeType = ext ? mimeTypes[ext] : undefined
            res.setHeader('Content-Type', mimeType || 'application/octet-stream')
            res.end(content)
            return
          }
        }
        next()
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        external: ['node-pty', 'better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload'
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    server: {
      host: true,  // Expose to network for mobile live reload
      hmr: false,  // Disable hot reload - use manual refresh button in debug mode
      watch: null  // Disable file watching to prevent reconnection spam
    },
    plugins: [react(), serveWhisperFiles()]
  }
})
