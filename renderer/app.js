// Simple tabs
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
  
  // Download console log button
  document.getElementById('download-console')?.addEventListener('click', () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    // Capture console methods
    console.log = (...args) => {
      logs.push(`[LOG] ${args.join(' ')}`);
      originalLog.apply(console, args);
    };
    console.error = (...args) => {
      logs.push(`[ERROR] ${args.join(' ')}`);
      originalError.apply(console, args);
    };
    console.warn = (...args) => {
      logs.push(`[WARN] ${args.join(' ')}`);
      originalWarn.apply(console, args);
    };
    
    // Get existing logs from console
    const consoleElement = document.querySelector('body');
    const logText = logs.join('\n');
    
    // Download as text file
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-console-${new Date().toISOString().replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('[Download] Console log downloaded');
  });
  
  // Settings
  const settingsSaveBtn = document.getElementById('settings-save');
  const settingsTestBtn = document.getElementById('settings-test');
  const projectRootInput = document.getElementById('project-root-input');
  const contextFileInput = document.getElementById('context-file-input');
  const contextFileSelectBtn = document.getElementById('context-file-select');
  
  // 保存済みのプロジェクトルートを読み込む
  const savedRoot = localStorage.getItem('project-root');
  if (savedRoot) {
    projectRootInput.value = savedRoot;
  }
  
  settingsSaveBtn?.addEventListener('click', () => {
    const rootPath = projectRootInput.value.trim();
    if (rootPath) {
      localStorage.setItem('project-root', rootPath);
      alert('設定を保存しました。アプリを再起動して反映してください。');
    }
  });
  
  settingsTestBtn?.addEventListener('click', async () => {
    const rootPath = projectRootInput.value.trim();
    if (!rootPath) {
      alert('パスを入力してください');
      return;
    }
    
    // パスをテスト（ファイルの存在確認）
    try {
      const testFiles = [
        rootPath + '/apps/mobile/pubspec.yaml',
        rootPath + '/docs/PRD/index.mdc',
        rootPath + '/human_todo.mdc'
      ];
      
      const found = testFiles.find(p => {
        try {
          return require('fs').existsSync(p);
        } catch {
          return false;
        }
      });
      
      if (found) {
        alert('パステスト成功: ' + found);
      } else {
        alert('パステスト: プロジェクトルートとして認識できませんでした');
      }
    } catch (e) {
      alert('パステスト失敗: ' + e.message);
    }
  });
  
  // Context File選択
  // 初期化: 保存済みパスを読み込み
  if (contextFileInput) {
    const savedPath = localStorage.getItem('context-file-path');
    if (savedPath) {
      contextFileInput.value = savedPath;
    }
  }
  
  // ファイル選択
  contextFileSelectBtn?.addEventListener('click', async () => {
    try {
      const result = await window.dialog.selectContextFile();
      if (!result.canceled && result.filePath) {
        contextFileInput.value = result.filePath;
        localStorage.setItem('context-file-path', result.filePath);
        alert('Context Fileを設定しました。アプリを再起動してください。');
      }
    } catch (e) {
      alert('ファイル選択に失敗しました: ' + e.message);
    }
  });
});

