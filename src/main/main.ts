import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { withPathValidation } from './handlers/security.js';
import { logger } from './utils/logger.js';

let mainWindow: BrowserWindow | null = null;

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
  const rendererPath = path.join(appPath, '..', '..', '..', 'renderer');
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

// Global variable to store custom project root
let customProjectRoot: string | null = null;

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
    logger.debug('Reading document', { relPath: validation.normalized, target: validation.target, repoRoot: validation.repoRoot });
    const content = fs.readFileSync(validation.target, 'utf8');
    logger.info('Document read successfully', { target: path.relative(validation.repoRoot, validation.target) });
    return { success: true, content };
  } catch (e) {
    logger.error('Failed to read document', { error: (e as Error).message, target: validation.target });
    return { success: false, error: (e as Error).message };
  }
}));

ipcMain.handle('docs:open', withPathValidation(async (event, validation) => {
  try {
    logger.debug('Opening document', { relPath: validation.normalized });
    const result = await shell.openPath(validation.target);
    if (result) throw new Error(result);
    logger.info('Document opened successfully', { target: path.relative(validation.repoRoot, validation.target) });
    return { success: true };
  } catch (e) {
    logger.error('Failed to open document', { error: (e as Error).message, target: validation.target });
    return { success: false, error: (e as Error).message };
  }
}));

// Tasks
ipcMain.handle('tasks:readJson', async () => {
  try {
    const target = path.join(__dirname, '..', '..', 'tasks.json');
    logger.debug('Reading tasks.json', { target });
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
    const target = path.join(__dirname, '..', '..', 'tasks.json');
    logger.debug('Writing tasks.json', { target, dataCount: Array.isArray(data) ? data.length : 'unknown' });
    fs.writeFileSync(target, JSON.stringify(data ?? [], null, 2), 'utf8');
    logger.info('tasks.json written successfully');
    return { success: true };
  } catch (e) {
    logger.error('Failed to write tasks.json', { error: (e as Error).message });
    return { success: false, error: (e as Error).message };
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

