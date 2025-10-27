import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('docs', {
  read: (relPath: string): Promise<string> => ipcRenderer.invoke('docs:read', relPath),
  open: (relPath: string): Promise<void> => ipcRenderer.invoke('docs:open', relPath)
});

contextBridge.exposeInMainWorld('tasks', {
  readJson: (): Promise<any> => ipcRenderer.invoke('tasks:readJson'),
  writeJson: (data: any): Promise<void> => ipcRenderer.invoke('tasks:writeJson', data),
  appendMdc: (relPath: string, content: string): Promise<void> => ipcRenderer.invoke('mdc:append', relPath, content),
  recordRecommendationSelection: (data: any): Promise<void> => ipcRenderer.invoke('tasks:recordRecommendationSelection', data),
  readRecommendationHistory: (): Promise<any> => ipcRenderer.invoke('tasks:readRecommendationHistory')
});

contextBridge.exposeInMainWorld('prompts', {
  readJson: (): Promise<any> => ipcRenderer.invoke('prompts:readJson'),
  writeJson: (data: any): Promise<void> => ipcRenderer.invoke('prompts:writeJson', data)
});

contextBridge.exposeInMainWorld('env', {
  isDebug: (): Promise<boolean> => ipcRenderer.invoke('env:isDebug')
});

contextBridge.exposeInMainWorld('settings', {
  getProjectRoot: (): Promise<{ root: string }> => ipcRenderer.invoke('settings:getProjectRoot'),
  setProjectRoot: (root: string): Promise<void> => ipcRenderer.invoke('settings:setProjectRoot', root),
  testProjectRoot: (root: string): Promise<any> => ipcRenderer.invoke('settings:testProjectRoot', root),
  getAiProvider: (): Promise<{ providerId: string }> => ipcRenderer.invoke('settings:getAiProvider'),
  setAiProvider: (providerId: string): Promise<void> => ipcRenderer.invoke('settings:setAiProvider', providerId)
});

contextBridge.exposeInMainWorld('dialog', {
  selectContextFile: (): Promise<{ filePath?: string; canceled: boolean }> =>
    ipcRenderer.invoke('dialog:selectContextFile')
});

contextBridge.exposeInMainWorld('rulesWatcher', {
  onEvent: (callback: (payload: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('rules:watcher:event', handler);
    return () => ipcRenderer.removeListener('rules:watcher:event', handler);
  },
  getState: () => ipcRenderer.invoke('rules:getLatestState'),
  revalidate: (mode: 'manual' | 'bulk') => ipcRenderer.invoke('rules:revalidate', { mode }),
  scan: () => ipcRenderer.invoke('rules:scanImpacts'),
  listLogs: () => ipcRenderer.invoke('rules:listLogs'),
  setContextPath: (contextPath: string | null) => ipcRenderer.invoke('rules:setContext', { contextPath })
});


