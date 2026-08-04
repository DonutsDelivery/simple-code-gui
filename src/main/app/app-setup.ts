import { app, crashReporter, session } from 'electron'
import { DONUTCODE_APP_NAME, DONUTCODE_APP_SLUG } from '../brand-migration.js'

export const IS_DEBUG_MODE = process.argv.includes('--debug') || process.env.DEBUG_MODE === '1'

export function setupAppConfig(): void {
  // Set app name and WM_CLASS for proper Linux taskbar integration
  app.setName(DONUTCODE_APP_NAME)
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('class', DONUTCODE_APP_SLUG)
    app.commandLine.appendSwitch('name', DONUTCODE_APP_SLUG)
  }

  // Enable GPU acceleration
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')

  // Configure crash reporter for packaged builds
  if (app.isPackaged) {
    crashReporter.start({
      productName: DONUTCODE_APP_NAME,
      submitURL: '', // Set to crash collection server URL when available
      uploadToServer: false // Enable when submitURL is configured
    })
  }
}

export function setupSecurityHeaders(): void {
  // M7: in packaged builds drop full 'unsafe-eval' (a key XSS escalation primitive)
  // and keep only 'wasm-unsafe-eval', which xterm/WASM need. Dev (Vite HMR) still
  // requires full eval, so only relax it for the unpackaged dev renderer.
  const scriptSrc = app.isPackaged
    ? "script-src 'self' 'wasm-unsafe-eval' blob:; "
    : "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; "
  // Enable Cross-Origin Isolation for SharedArrayBuffer and configure CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Content-Security-Policy': [
          "default-src 'self'; " +
          scriptSrc +
          "worker-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://huggingface.co https://*.huggingface.co https://*.hf.co ws: wss: http: https:; " +
          "img-src 'self' data: blob:; " +
          "media-src 'self' blob:"
        ]
      }
    })
  })
}
