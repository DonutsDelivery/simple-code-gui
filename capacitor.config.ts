import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.claudeterminal.app',
  appName: 'Claude Terminal',
  webDir: 'dist/renderer',
  server: {
    // Allow cleartext for local network connections to host PC
    cleartext: true,
    // Uncomment for development with Vite dev server:
    // url: 'http://localhost:5173',
  },
  plugins: {
    Preferences: {
      // Uses defaults
    }
  },
  android: {
    // Allow mixed content for WebSocket connections
    allowMixedContent: true
  }
}

export default config
