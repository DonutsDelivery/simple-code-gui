import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.claudeterminal.app',
  appName: 'Claude Terminal',
  webDir: 'dist/renderer',
  server: {
    // Dev server config - connects to Vite dev server
    url: 'http://localhost:5173',
    cleartext: true
  },
  plugins: {
    BarcodeScanner: {
      // Barcode scanner plugin config
    },
    Preferences: {
      // Preferences plugin config (uses defaults)
    }
  }
}

export default config
