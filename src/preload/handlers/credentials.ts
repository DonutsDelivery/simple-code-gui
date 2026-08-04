import { ipcRenderer } from 'electron'

export const credentialHandlers = {
  secureCredentialsAvailable: (): Promise<boolean> => ipcRenderer.invoke('credentials:isAvailable'),
  storeSecureCredential: (ref: string, credential: string): Promise<boolean> => ipcRenderer.invoke('credentials:store', ref, credential),
  loadSecureCredential: (ref: string): Promise<string | null> => ipcRenderer.invoke('credentials:load', ref),
  removeSecureCredential: (ref: string): Promise<void> => ipcRenderer.invoke('credentials:remove', ref),
}
