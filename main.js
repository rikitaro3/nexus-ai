const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Catch uncaught exceptions and log them instead of showing popup
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Renderer] ウィンドウが応答しなくなりました');
  });
  
  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('[Renderer] ウィンドウがクラッシュしました:', killed ? '強制終了' : 'クラッシュ');
  });
  
  // Log renderer errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Renderer] Load failed:', errorCode, errorDescription, validatedURL);
  });
  
  // Forward console messages from renderer to stdout
  // Always log errors and warnings, and all messages in E2E mode
  mainWindow.webContents.on('console-message', (event, level, message) => {
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
        mainWindow.webContents.executeJavaScript(`
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Env: isDebug
const isDebug = (process.env.NEXUS_DEBUG === '1' || !app.isPackaged);
ipcMain.handle('env:isDebug', async () => {
  return { success: true, isDebug };
});

// Docs
ipcMain.handle('docs:read', async (event, relPath) => {
  try {
    const repoRoot = path.join(__dirname, '../..');
    const target = path.normalize(path.join(repoRoot, relPath));
    if (!target.startsWith(repoRoot)) throw new Error('パスがリポジトリ外');
    const content = fs.readFileSync(target, 'utf8');
    return { success: true, content };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('docs:open', async (event, relPath) => {
  try {
    const repoRoot = path.join(__dirname, '../..');
    const target = path.normalize(path.join(repoRoot, relPath));
    if (!target.startsWith(repoRoot)) throw new Error('パスがリポジトリ外');
    const result = await shell.openPath(target);
    if (result) throw new Error(result);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Tasks
ipcMain.handle('tasks:readJson', async () => {
  try {
    const target = path.join(__dirname, 'tasks.json');
    if (!fs.existsSync(target)) return { success: true, data: [] };
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('tasks:writeJson', async (event, data) => {
  try {
    const target = path.join(__dirname, 'tasks.json');
    fs.writeFileSync(target, JSON.stringify(data ?? [], null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// MDC append (optional)
ipcMain.handle('mdc:append', async (event, relPath, content) => {
  try {
    const repoRoot = path.join(__dirname, '../..');
    const target = path.normalize(path.join(repoRoot, relPath));
    if (!target.startsWith(repoRoot)) throw new Error('パスがリポジトリ外');
    const stamp = new Date().toISOString();
    const header = `\n\n## Imported from Nexus (${stamp})\n`;
    fs.appendFileSync(target, header + (content || ''), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


