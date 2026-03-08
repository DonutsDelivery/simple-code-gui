import { app, crashReporter, session } from 'electron'

export const IS_DEBUG_MODE = process.argv.includes('--debug') || process.env.DEBUG_MODE === '1'

export function setupAppConfig(): void {
  // Set app name and WM_CLASS for proper Linux taskbar integration
  app.setName('simple-code-gui')
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('class', 'simple-code-gui')
    app.commandLine.appendSwitch('name', 'simple-code-gui')
  }

  // Enable GPU acceleration
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')

  // Configure crash reporter for packaged builds
  if (app.isPackaged) {
    crashReporter.start({
      productName: 'Simple Code GUI',
      submitURL: '', // Set to crash collection server URL when available
      uploadToServer: false // Enable when submitURL is configured
    })
  }
}

export function setupSecurityHeaders(): void {
  // Enable Cross-Origin Isolation for SharedArrayBuffer and configure CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
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
