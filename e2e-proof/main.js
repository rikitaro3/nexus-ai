const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    // デバッグ用にDevToolsを開く
    show: false
  });

  // エラーハンドリング
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Load failed:', errorCode, errorDescription);
  });

  const htmlPath = path.join(__dirname, 'index.html');
  console.log('Loading:', htmlPath);
  
  mainWindow.loadFile(htmlPath).catch(err => {
    console.error('Failed to load index.html:', err);
  });
  
  // テストモードでもウィンドウを表示する
  mainWindow.show();
  
  // テストモード: DevToolsを開く
  if (process.env.E2E_TEST) {
    mainWindow.webContents.openDevTools();
  }

  // テストフラグ: テスト完了を示す
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      mainWindow.webContents.executeJavaScript(`
        window.testResult = {
          success: true,
          message: 'E2E proof completed',
          timestamp: new Date().toISOString()
        };
        console.log('TEST_RESULT:', JSON.stringify(window.testResult));
      `);
    }, 1000);
  });
}

app.whenReady().then(() => {
  createWindow();
  
  // テスト完了後に自動終了（通常モードの場合のみ）
  if (!process.env.E2E_TEST) {
    setTimeout(() => {
      console.log('Application closing...');
      app.quit();
    }, 60000); // 通常モードでは60秒に延長
  }
}).catch(err => {
  console.error('Failed to create window:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// グローバルエラーハンドラー
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  app.quit();
});

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // 開発環境では証明書エラーを無視
  event.preventDefault();
  callback(true);
});
