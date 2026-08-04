import { ipcRenderer } from 'electron'

export const credentialHandlers = {
  secureCredentialsAvailable: (): Promise<boolean> => ipcRenderer.invoke('credentials:isAvailable'),
  storeSecureCredential: (ref: string, credential: string): Promise<boolean> => ipcRenderer.invoke('credentials:store', ref, credential),
  loadSecureCredential: (ref: string): Promise<string | null> => ipcRenderer.invoke('credentials:load', ref),
  removeSecureCredential: (ref: string): Promise<void> => ipcRenderer.invoke('credentials:remove', ref),
  trustServerCertificate: (endpoint: string, fingerprint: string): Promise<void> => ipcRenderer.invoke('server-certificates:trust', endpoint, fingerprint),
  probeServerCertificate: (endpoint: string): Promise<string> => ipcRenderer.invoke('server-certificates:probe', endpoint),
  removeServerCertificateTrust: (endpoint: string): Promise<void> => ipcRenderer.invoke('server-certificates:remove', endpoint),
}
