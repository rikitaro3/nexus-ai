const { test, expect } = require('@playwright/test');

/**
 * E2E基盤の実装可能性検証（最小構成）
 * 
 * Playwright の electron.launch() を使用した最小構成のテスト
 */

test('E2E基盤の実装可能性検証', async ({ browser }) => {
  test.setTimeout(60000);
  console.log('🧪 E2E基盤の実装可能性検証を開始...\n');
  
  // Electronアプリを起動
  console.log('1. Electronアプリを起動中...');
  const { _electron: electron } = require('@playwright/test');
  const electronApp = await electron.launch({ 
    args: ['main.js'],
    env: { E2E_TEST: '1' }
  });
  
  console.log('✓ Electron起動成功');
  
  // 最初のウィンドウを取得
  console.log('2. ウィンドウを取得中...');
  const window = await electronApp.firstWindow();
  console.log('✓ ウィンドウ取得成功');
  
  // ウィンドウの状態を検証
  expect(window).toBeTruthy();
  
  // テストボタンをクリック（要素の表示を待つ）
  console.log('3. テストボタンを検索中...');
  await window.waitForSelector('#test-btn', { timeout: 10000 });
  console.log('✓ ボタン見つかった');
  
  console.log('4. テストボタンをクリック中...');
  await window.click('#test-btn');
  console.log('✓ ボタンクリック成功');
  
  // テスト結果を待機して取得
  console.log('5. テスト結果を待機中...');
  await window.waitForFunction(() => window.testResult !== undefined, { timeout: 10000 });
  
  console.log('6. テスト結果を取得中...');
  const result = await window.evaluate(() => {
    return window.testResult;
  });
  
  console.log('✓ テスト結果:', JSON.stringify(result, null, 2));
  
  // スクリーンショットを取得
  console.log('7. スクリーンショットを保存中...');
  await window.screenshot({ path: 'e2e-proof.png' });
  console.log('✓ スクリーンショット保存完了');
  
  // アプリを閉じる
  console.log('8. Electronを終了中...');
  await electronApp.close();
  console.log('✓ Electron終了成功');
  
  console.log('\n✅ E2E基盤の実装可能性検証: 成功');
  console.log('   - Electron起動: OK');
  console.log('   - ウィンドウ取得: OK');
  console.log('   - UI操作: OK');
  console.log('   - テスト結果検証: OK');
  
  expect(result).toBeTruthy();
  expect(result.success).toBe(true);
});

