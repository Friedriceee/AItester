import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  startRecording: (url: string) => ipcRenderer.invoke('start-recording', url),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  generateCases: (irPath: string, format: string, outPath?: string) =>
    ipcRenderer.invoke('generate-cases', { irPath, format, outPath }),
  onLogMessage: (callback: (message: { type: 'info' | 'error'; message: string }) => void) =>
    ipcRenderer.on('log-message', (_event, value) => callback(value)),
});