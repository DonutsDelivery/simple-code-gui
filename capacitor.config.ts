import type { CapacitorConfig } from '@capacitor/cli'

// DEVELOPMENT: Set to your IP for live reload, comment out for production APK
// const LIVE_RELOAD_URL = 'http://192.168.0.253:5173'
const LIVE_RELOAD_URL = undefined  // Production build - assets bundled in APK

const config: CapacitorConfig = {
  appId: 'com.claudeterminal.app',
  appName: 'Claude Terminal',
  webDir: 'dist/renderer',
  server: {
    // Use http scheme - needed for connecting to local HTTP servers
    androidScheme: 'http',
    // SECURITY: Restrict navigation to local network patterns only
    // This prevents the WebView from navigating to arbitrary external sites
    allowNavigation: [
      'localhost',
      '127.0.0.1',
      '10.*',
      '192.168.*',
      '172.16.*', '172.17.*', '172.18.*', '172.19.*',
      '172.20.*', '172.21.*', '172.22.*', '172.23.*',
      '172.24.*', '172.25.*', '172.26.*', '172.27.*',
      '172.28.*', '172.29.*', '172.30.*', '172.31.*',
      // Tailscale CGNAT range (100.64.0.0/10)
      '100.*',
      // Tailscale MagicDNS hostnames
      '*.ts.net'
    ],
    // SECURITY: cleartext needed for local network HTTP/WS connections
    // Android network_security_config.xml should further restrict this
    cleartext: true,
    // Live reload URL (comment out for production)
    url: LIVE_RELOAD_URL,
  },
  plugins: {
    Preferences: {
      // Uses defaults
    },
    CapacitorHttp: {
      // Disable native HTTP to allow WebSocket to work
      enabled: false
    }
  },
  android: {
    // Allow mixed content - needed for HTTP connections to local servers
    allowMixedContent: true
  }
}

export default config
