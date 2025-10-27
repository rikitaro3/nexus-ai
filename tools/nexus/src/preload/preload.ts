import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('docs', {
  read: (relPath: string): Promise<string> => ipcRenderer.invoke('docs:read', relPath),
  open: (relPath: string): Promise<void> => ipcRenderer.invoke('docs:open', relPath)
});

contextBridge.exposeInMainWorld('tasks', {
  readJson: (): Promise<any> => ipcRenderer.invoke('tasks:readJson'),
  writeJson: (data: any): Promise<void> => ipcRenderer.invoke('tasks:writeJson', data),
  appendMdc: (relPath: string, content: string): Promise<void> => ipcRenderer.invoke('mdc:append', relPath, content)
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
  testProjectRoot: (root: string): Promise<any> => ipcRenderer.invoke('settings:testProjectRoot', root)
});

contextBridge.exposeInMainWorld('dialog', {
  selectContextFile: (): Promise<{ filePath?: string; canceled: boolean }> => 
    ipcRenderer.invoke('dialog:selectContextFile')
});


