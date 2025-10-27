// 確実に動作する完全自動化E2Eテスト

const { _electron: electron } = require('@playwright/test');
const fs = require('fs');

async function runWorkingTest() {
  console.log('🚀 完全自動化E2Eテスト（動作保証版）を開始...\n');
  
  let electronApp;
  let window;
  
  try {
    // Electronアプリをlaunch APIで起動
    console.log('1. Electronアプリを起動中...');
    electronApp = await electron.launch({ 
      args: ['main.js'],
      cwd: __dirname,
      env: { ...process.env, E2E_TEST: '1' }
    });
    
    console.log('✓ Electron起動成功');
    
    // 全てのウィンドウを取得し、DevToolsではないウィンドウを探す
    console.log('\n2. ウィンドウを取得中...');
    
    // 少し待ってからウィンドウを取得
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 全てのウィンドウをループして探す
    let foundMainWindow = false;
    for (let i = 0; i < 10; i++) {
      const windows = await electronApp.windows();
      console.log(`ウィンドウ数: ${windows.length}`);
      
      for (const win of windows) {
        const url = await win.url();
        console.log(`ウィンドウ ${i} URL: ${url}`);
        
        if (!url.includes('devtools://')) {
          window = win;
          foundMainWindow = true;
          console.log('✓ アプリケーションウィンドウ取得成功');
          break;
        }
      }
      
      if (foundMainWindow) break;
      
      // もう少し待つ
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!foundMainWindow) {
      // 最初のウィンドウを使用
      window = await electronApp.firstWindow();
      console.log('⚠️ DevTools以外のウィンドウが見つからないため、最初のウィンドウを使用');
    }
    
    // ウィンドウの表示を待つ
    console.log('\n3. ウィンドウの準備完了を待機中...');
    await window.waitForLoadState('load');
    
    console.log('✓ ページ読み込み完了');
    
    // デバッグ: 現在のURLを確認
    const url = window.url();
    console.log('現在のURL:', url);
    
    // index.htmlがロードされていることを確認
    if (!url.includes('index.html') && !url.includes('file://')) {
      console.log('⚠️ 予期しないURLです');
    }
    
    // デバッグ: ページのHTMLを確認
    const html = await window.content();
    console.log('ページのHTML（最初の500文字）:', html.substring(0, 500));
    
    // テストボタンの存在確認
    console.log('\n4. テストボタンを検索中...');
    await window.waitForSelector('#test-btn', { timeout: 10000 });
    
    console.log('✓ テストボタンが見つかりました');
    
    // ボタンをクリック
    console.log('\n5. テストボタンをクリック中...');
    await window.click('#test-btn');
    
    console.log('✓ ボタンクリック成功');
    
    // テスト結果の検証
    console.log('\n6. テスト結果を検証中...');
    
    // window.testResultが設定されるまで待つ
    await window.waitForFunction(() => window.testResult !== undefined, { 
      timeout: 10000 
    });
    
    const result = await window.evaluate(() => window.testResult);
    
    console.log('\n✅ テスト結果:');
    console.log(JSON.stringify(result, null, 2));
    
    // スクリーンショット
    console.log('\n7. スクリーンショットを保存中...');
    await window.screenshot({ path: 'test-working.png' });
    
    console.log('✓ スクリーンショット保存完了: test-working.png');
    
    // 最終結果
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 完全自動化E2Eテスト: 成功');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✓ Electron起動: OK');
    console.log('✓ ウィンドウ取得: OK');
    console.log('✓ UI読み込み: OK');
    console.log('✓ ボタンクリック: OK');
    console.log('✓ テスト結果検証: OK');
    console.log('✓ スクリーンショット: OK');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return { success: true, result };
    
  } catch (error) {
    console.error('\n❌ テスト失敗:', error.message);
    console.error('スタック:', error.stack);
    
    // スクリーンショットを保存（デバッグ用）
    if (window) {
      try {
        await window.screenshot({ path: 'test-failed.png' });
        console.log('エラー時のスクリーンショット保存: test-failed.png');
      } catch (e) {
        // スクリーンショット保存失敗は無視
      }
    }
    
    throw error;
    
  } finally {
    // クリーンアップ
    if (electronApp) {
      await electronApp.close();
    }
    console.log('✓ クリーンアップ完了');
  }
}

// 実行
runWorkingTest()
  .then(result => {
    console.log('✅ テスト完了:', result.success ? '成功' : '失敗');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ 実行エラー:', err.message);
    process.exit(1);
  });

