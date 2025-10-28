import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  RulesWatcherEvent,
  RulesWatcherEventEnvelope,
  RulesWatcherLogList
} from '../types/rules-watcher.js';

contextBridge.exposeInMainWorld('docs', {
  read: (relPath: string): Promise<string> => ipcRenderer.invoke('docs:read', relPath),
  open: (relPath: string): Promise<void> => ipcRenderer.invoke('docs:open', relPath),
  listTemplates: (): Promise<any> => ipcRenderer.invoke('docs:listTemplates'),
  createFromTemplate: (payload: any): Promise<any> => ipcRenderer.invoke('docs:createFromTemplate', payload)
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
  onEvent: (callback: (payload: RulesWatcherEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: RulesWatcherEvent) => callback(payload);
    ipcRenderer.on('rules:watcher:event', handler);
    return () => ipcRenderer.removeListener('rules:watcher:event', handler);
  },
  async getState(): Promise<RulesWatcherEventEnvelope> {
    return ipcRenderer.invoke('rules:getLatestState');
  },
  async revalidate(mode: 'manual' | 'bulk'): Promise<RulesWatcherEventEnvelope> {
    return ipcRenderer.invoke('rules:revalidate', { mode });
  },
  async scan(): Promise<RulesWatcherEventEnvelope> {
    return ipcRenderer.invoke('rules:scanImpacts');
  },
  async listLogs(): Promise<{ success: boolean; logs?: RulesWatcherLogList; error?: string }> {
    return ipcRenderer.invoke('rules:listLogs');
  },
  async setContextPath(contextPath: string | null): Promise<RulesWatcherEventEnvelope> {
    return ipcRenderer.invoke('rules:setContext', { contextPath });
  }
});


