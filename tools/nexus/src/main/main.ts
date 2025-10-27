import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoRoot, withPathValidation } from './handlers/security.js';
import { logger } from './utils/logger.js';
import { createRulesWatcher, RulesWatcherController, RulesWatcherEvent } from './watchers/rules-watcher.js';

let mainWindow: BrowserWindow | null = null;
let rulesWatcher: RulesWatcherController | null = null;

// プロジェクトルートを計算（main.jsから見た場合）
// 環境変数を最優先
const PROJECT_ROOT = process.env.NEXUS_PROJECT_ROOT 
  ? process.env.NEXUS_PROJECT_ROOT
  : (() => {
      // __dirname は dist/src/main
      // 確実な方法: 親ディレクトリを特徴ファイルで検索
      let searchDir = __dirname;
      for (let i = 0; i < 10; i++) {
        const marker = path.join(searchDir, 'tools', 'nexus', 'context.mdc');
        if (fs.existsSync(marker)) {
          logger.info('Project root found', { root: searchDir, depth: i });
          return searchDir;
        }
        searchDir = path.dirname(searchDir);
      }
      throw new Error('Project root not found');
    })();

const NEXUS_DIR = path.dirname(path.dirname(__dirname)); // dist/src/main -> dist
const PROMPTS_JSON_PATH = path.join(PROJECT_ROOT, 'tools', 'nexus', 'prompts.json');
const DEFAULT_AI_PROVIDER_ID = 'cursor';

rulesWatcher = createRulesWatcher({
  projectRoot: PROJECT_ROOT,
  notify: (event: RulesWatcherEvent) => {
    if (mainWindow) {
      mainWindow.webContents.send('rules:watcher:event', event);
    }
  }
});

logger.info('Project root initialized', { 
  __dirname,
  NEXUS_DIR,
  PROJECT_ROOT,
  'PROJECT_ROOT_basename': path.basename(PROJECT_ROOT),
  'NEXUS_DIR_basename': path.basename(NEXUS_DIR)
});

function createWindow() {
  // Adjust paths for TypeScript compilation (dist/ folder)
  const appPath = __dirname;
  const rendererPath = path.join(PROJECT_ROOT, 'tools', 'nexus', 'src', 'renderer');
  const preloadPath = path.join(appPath, '..', 'preload', 'preload.js');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });
  
  // Open DevTools in debug mode
  if (process.env.NEXUS_DEBUG === '1' || !process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }
  
  // E2Eテスト時はデフォルトでNEXUSコンテキストを使用
  if (process.env.E2E_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow!.webContents.executeJavaScript(`
        if (!localStorage.getItem('nexus.context')) {
          localStorage.setItem('nexus.context', 'nexus');
          location.reload();
        }
      `).catch(err => logger.error('Failed to set context:', err));
    });
  }
  
  mainWindow.loadFile(path.join(rendererPath, 'index.html'));

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      if (rulesWatcher) {
        const snapshot = await rulesWatcher.getLatest();
        mainWindow?.webContents.send('rules:watcher:event', snapshot);
      }
    } catch (error) {
      logger.error('Failed to push initial rules watcher snapshot', { error: (error as Error).message });
    }
  });
  
  // Catch uncaught exceptions and log them instead of showing popup
  (mainWindow.webContents as any).on('unresponsive', () => {
    logger.error('ウィンドウが応答しなくなりました');
  });
  
  (mainWindow.webContents as any).on('crashed', (event: any, killed: boolean) => {
    logger.error('ウィンドウがクラッシュしました', { killed });
  });
  
  // Log renderer errors
  (mainWindow.webContents as any).on('did-fail-load', (event: any, errorCode: number, errorDescription: string, validatedURL: string) => {
    logger.error('Load failed', { errorCode, errorDescription, validatedURL });
  });
  
  // Forward console messages from renderer to stdout
  // Always log errors and warnings, and all messages in E2E mode
  (mainWindow.webContents as any).on('console-message', (event: any, level: string, message: string) => {
    if (level === 'error') {
      console.error(`[Renderer ERROR]:`, message);
    } else if (level === 'warning') {
      console.warn(`[Renderer WARN]:`, message);
    } else if (process.env.E2E_TEST === '1') {
      console.log(`[Renderer ${level}]:`, message);
    }
  });
  
  // E2E test auto-click
  if (process.env.E2E_TEST === '1') {
    console.log('E2E_TEST mode enabled');
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('E2E: Page loaded, waiting to click Tree button...');
      setTimeout(() => {
        console.log('E2E: Executing auto-click script...');
        mainWindow!.webContents.executeJavaScript(`
          (function() {
            setTimeout(() => {
              console.log('[E2E] Looking for Tree button...');
              const treeBtn = document.querySelector('button[data-mode="tree"]');
              console.log('[E2E] Tree button found:', treeBtn !== null);
              if (treeBtn) {
                console.log('[E2E] Clicking Tree button...');
                treeBtn.click();
                console.log('[E2E] Tree button clicked');
                console.log('[E2E] Waiting for renderTree...');
                // Give renderTree time to execute
                setTimeout(() => {
                  console.log('[E2E] Tree should be rendered now');
                }, 2000);
              } else {
                console.log('[E2E] Tree button not found');
              }
            }, 1000);
          })();
        `).catch(err => console.error('E2E: JavaScript execution failed:', err));
      }, 2000);
    });
  }
}

// Global project rootを設定
const { setGlobalProjectRoot } = require('./handlers/security');
setGlobalProjectRoot(PROJECT_ROOT);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (rulesWatcher) {
    rulesWatcher.dispose();
  }
});

// Global variable to store custom project root
let customProjectRoot: string | null = null;
let selectedAiProviderId: string | null = null;

// Env: isDebug
const isDebug = (process.env.NEXUS_DEBUG === '1' || !app.isPackaged);
ipcMain.handle('env:isDebug', async () => {
  return { success: true, isDebug };
});

// Settings: get/set project root
ipcMain.handle('settings:getProjectRoot', async () => {
  if (customProjectRoot) {
    return { root: customProjectRoot };
  }
  // PROJECT_ROOTを直接返す
  logger.info('Getting project root', { PROJECT_ROOT });
  return { root: PROJECT_ROOT };
});

ipcMain.handle('settings:setProjectRoot', async (event, root: string) => {
  const { setCustomProjectRoot } = require('./handlers/security');
  setCustomProjectRoot(root);
  customProjectRoot = root;
  logger.info('Custom project root set', { root });
  return { success: true };
});

ipcMain.handle('settings:testProjectRoot', async (_event, root?: string) => {
  try {
    const baseRoot = root && root.trim() ? root.trim() : getRepoRoot();
    const resolvedRoot = path.resolve(baseRoot);

    if (!fs.existsSync(resolvedRoot)) {
      return {
        success: false,
        error: `Path does not exist: ${resolvedRoot}`
      };
    }

    const requiredPaths = [
      'apps/mobile/pubspec.yaml',
      'docs/PRD/index.mdc',
      'human_todo.mdc'
    ];

    const results: Record<string, boolean> = {};
    for (const rel of requiredPaths) {
      const target = path.join(resolvedRoot, rel);
      results[rel] = fs.existsSync(target);
    }

    const missing = Object.entries(results)
      .filter(([, ok]) => !ok)
      .map(([rel]) => rel);

    return {
      success: true,
      root: resolvedRoot,
      results,
      missing
    };
  } catch (e) {
    const message = (e as Error).message;
    logger.error('Failed to test project root', { error: message, root });
    return { success: false, error: message };
  }
});

ipcMain.handle('settings:getAiProvider', async () => {
  const providerId = (selectedAiProviderId && selectedAiProviderId.trim()) || DEFAULT_AI_PROVIDER_ID;
  logger.info('Getting AI provider', { providerId });
  return { providerId };
});

ipcMain.handle('settings:setAiProvider', async (_event, providerId?: string) => {
  const normalized = typeof providerId === 'string' ? providerId.trim() : '';
  if (!normalized) {
    const error = 'Invalid AI provider id';
    logger.warn('Rejected AI provider update', { providerId });
    throw new Error(error);
  }
  selectedAiProviderId = normalized;
  logger.info('AI provider updated', { providerId: normalized });
  return { success: true };
});

// Dialog: select context file
ipcMain.handle('dialog:selectContextFile', async () => {
  if (!mainWindow) {
    logger.error('Main window not available for dialog');
    return { canceled: true };
  }
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Context File',
    filters: [
      { name: 'Markdown', extensions: ['mdc', 'md'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled || !result.filePaths[0]) {
    logger.info('Context file selection canceled');
    return { canceled: true };
  }
  
  logger.info('Context file selected', { filePath: result.filePaths[0] });
  return { filePath: result.filePaths[0], canceled: false };
});

// Docs
ipcMain.handle('docs:read', withPathValidation(async (event, validation) => {
  try {
    const targetForLog = validation.allowedByWhitelist
      ? validation.target
      : path.relative(validation.repoRoot, validation.target);
    logger.debug('Reading document', {
      relPath: validation.normalized,
      target: validation.target,
      repoRoot: validation.repoRoot,
      allowedByWhitelist: validation.allowedByWhitelist === true
    });
    const content = fs.readFileSync(validation.target, 'utf8');
    logger.info('Document read successfully', {
      target: targetForLog,
      allowedByWhitelist: validation.allowedByWhitelist === true
    });
    return { success: true, content };
  } catch (e) {
    logger.error('Failed to read document', { error: (e as Error).message, target: validation.target });
    return { success: false, error: (e as Error).message };
  }
}));

ipcMain.handle('docs:open', withPathValidation(async (event, validation) => {
  try {
    const targetForLog = validation.allowedByWhitelist
      ? validation.target
      : path.relative(validation.repoRoot, validation.target);
    logger.debug('Opening document', {
      relPath: validation.normalized,
      target: validation.target,
      allowedByWhitelist: validation.allowedByWhitelist === true
    });
    const result = await shell.openPath(validation.target);
    if (result) throw new Error(result);
    logger.info('Document opened successfully', {
      target: targetForLog,
      allowedByWhitelist: validation.allowedByWhitelist === true
    });
    return { success: true };
  } catch (e) {
    logger.error('Failed to open document', { error: (e as Error).message, target: validation.target });
    return { success: false, error: (e as Error).message };
  }
}));

// Tasks
ipcMain.handle('tasks:readJson', async () => {
  try {
    const repoRoot = getRepoRoot();
    const target = path.join(repoRoot, 'tools', 'nexus', 'tasks.json');
    logger.debug('Reading tasks.json', { target, repoRoot });
    if (!fs.existsSync(target)) {
      logger.info('tasks.json does not exist, returning empty array');
      return { success: true, data: [] };
    }
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    logger.info('tasks.json read successfully', { dataCount: Array.isArray(data) ? data.length : 'unknown' });
    return { success: true, data };
  } catch (e) {
    logger.error('Failed to read tasks.json', { error: (e as Error).message });
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('tasks:writeJson', async (event, data: unknown) => {
  try {
    const repoRoot = getRepoRoot();
    const target = path.join(repoRoot, 'tools', 'nexus', 'tasks.json');
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info('Created directory for tasks.json', { dir });
    }
    logger.debug('Writing tasks.json', { target, repoRoot, dataCount: Array.isArray(data) ? data.length : 'unknown' });
    fs.writeFileSync(target, JSON.stringify(data ?? [], null, 2), 'utf8');
    logger.info('tasks.json written successfully');
    return { success: true };
  } catch (e) {
    logger.error('Failed to write tasks.json', { error: (e as Error).message });
    return { success: false, error: (e as Error).message };
  }
});

// Prompts dictionary
ipcMain.handle('prompts:readJson', async () => {
  try {
    logger.debug('Reading prompts.json', { target: PROMPTS_JSON_PATH });
    if (!fs.existsSync(PROMPTS_JSON_PATH)) {
      logger.info('prompts.json not found, returning null data');
      return { success: true, data: null };
    }
    const text = fs.readFileSync(PROMPTS_JSON_PATH, 'utf8');
    const data = JSON.parse(text);
    logger.info('prompts.json read successfully', {
      categories: Array.isArray(data?.categories) ? data.categories.length : 0
    });
    return { success: true, data };
  } catch (e) {
    logger.error('Failed to read prompts.json', { error: (e as Error).message });
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('prompts:writeJson', async (_event, data: unknown) => {
  try {
    const dir = path.dirname(PROMPTS_JSON_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = data ?? {};
    logger.debug('Writing prompts.json', {
      target: PROMPTS_JSON_PATH,
      categories: Array.isArray((payload as any)?.categories)
        ? (payload as any).categories.length
        : 'unknown'
    });
    fs.writeFileSync(PROMPTS_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
    logger.info('prompts.json written successfully');
    return { success: true };
  } catch (e) {
    logger.error('Failed to write prompts.json', { error: (e as Error).message });
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle('rules:getLatestState', async () => {
  try {
    if (!rulesWatcher) throw new Error('Rules watcher is not initialized');
    const snapshot = await rulesWatcher.getLatest();
    return { success: true, event: snapshot };
  } catch (error) {
    logger.error('Failed to get latest rules watcher state', { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rules:revalidate', async (_event, payload: { mode?: 'manual' | 'bulk' }) => {
  try {
    if (!rulesWatcher) throw new Error('Rules watcher is not initialized');
    const mode = payload?.mode === 'bulk' ? 'bulk' : 'manual';
    const snapshot = await rulesWatcher.revalidate(mode);
    return { success: true, event: snapshot };
  } catch (error) {
    logger.error('Failed to revalidate Quality Gates', { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rules:scanImpacts', async () => {
  try {
    if (!rulesWatcher) throw new Error('Rules watcher is not initialized');
    const snapshot = await rulesWatcher.scanOnly();
    return { success: true, event: snapshot };
  } catch (error) {
    logger.error('Failed to scan Quality Gates impacts', { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rules:listLogs', async () => {
  try {
    if (!rulesWatcher) throw new Error('Rules watcher is not initialized');
    const logs = await rulesWatcher.listLogs();
    return { success: true, logs };
  } catch (error) {
    logger.error('Failed to list Quality Gates logs', { error: (error as Error).message });
    return { success: false, error: (error as Error).message };
  }
});

// MDC append (optional)
ipcMain.handle('mdc:append', async (event, relPath: string, content: string) => {
  try {
    logger.debug('Appending to MDC file', { relPath });
    const validation = require('./handlers/security').validatePath(relPath);
    if (!validation.valid) {
      throw new Error(validation.error || 'パス検証失敗');
    }
    const stamp = new Date().toISOString();
    const header = `\n\n## Imported from Nexus (${stamp})\n`;
    fs.appendFileSync(validation.target, header + (content || ''), 'utf8');
    logger.info('MDC file appended successfully', { target: path.relative(validation.repoRoot, validation.target) });
    return { success: true };
  } catch (e) {
    logger.error('Failed to append to MDC file', { error: (e as Error).message, relPath });
    return { success: false, error: (e as Error).message };
  }
});

