const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * E2E基盤の実装可能性検証
 * 
 * 検証内容:
 * 1. Electronアプリ起動
 * 2. CDP経由で接続
 * 3. UI操作とログキャプチャ
 * 4. TEST_RESULT検証
 */

async function testE2EProof() {
  console.log('🧪 E2E基盤の実装可能性検証を開始...\n');
  
  let electronProcess;
  let browser;
  let page;
  
  try {
    // 1. Electron起動
    console.log('1. Electronアプリを起動中...');
    
    // Electronを直接起動（リモートデバッグ付き）
    const electronPath = require('electron');
    
    electronProcess = spawn(electronPath, ['.', '--remote-debugging-port=9222'], {
      cwd: __dirname,
      env: { ...process.env, E2E_TEST: '1' },
      shell: process.platform === 'win32'
    });
    
    console.log('Electron process started, PID:', electronProcess.pid);
    console.log('Remote debugging port: 9222');
    
    // stdout/stderrのキャプチャ
    const logs = [];
    electronProcess.stdout.on('data', (data) => {
      const text = data.toString();
      logs.push(`[stdout] ${text.trim()}`);
      console.log('[Electron stdout]:', text.trim());
    });
    
    electronProcess.stderr.on('data', (data) => {
      const text = data.toString();
      logs.push(`[stderr] ${text.trim()}`);
      console.log('[Electron stderr]:', text.trim());
    });
    
    // 2. 起動待機（20秒に延長）
    console.log('2. Electron起動完了を待機中...');
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    // 3. CDP接続（リトライ付き）
    console.log('3. CDP経由で接続中...');
    let retries = 0;
    let connected = false;
    
    while (retries < 20 && !connected) {
      try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
        connected = true;
        console.log('✓ CDP接続成功');
        break;
      } catch (e) {
        retries++;
        if (retries % 5 === 0) {
          console.log(`CDP接続リトライ ${retries}/20...`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!browser) {
      throw new Error('CDP接続失敗（最大リトライ回数に達しました）');
    }
    const contexts = browser.contexts();
    
    if (contexts.length === 0) {
      throw new Error('CDP接続失敗: コンテキストが見つかりません');
    }
    
    page = contexts[0].pages()[0];
    console.log('✓ ページ取得成功');
    
    // 4. UI操作（ボタンクリック）
    console.log('4. テストボタンをクリック...');
    await page.click('#test-btn');
    console.log('✓ ボタンクリック成功');
    
    // 5. テスト結果の検証
    console.log('5. テスト結果を検証中...');
    await page.waitForFunction(() => window.testResult !== undefined, { timeout: 10000 });
    const result = await page.evaluate(() => window.testResult);
    
    console.log('\n✅ テスト結果:', JSON.stringify(result, null, 2));
    
    // 6. スクリーンショット
    console.log('6. スクリーンショットを取得中...');
    await page.screenshot({ path: 'test-screenshot.png' });
    console.log('✓ スクリーンショット保存完了');
    
    // 7. ログを保存
    fs.writeFileSync('e2e-test-logs.txt', logs.join('\n'));
    console.log('✓ ログ保存完了');
    
    console.log('\n✅ E2E基盤の実装可能性検証: 成功');
    console.log('   - Electron起動: OK');
    console.log('   - CDP接続: OK');
    console.log('   - UI操作: OK');
    console.log('   - テスト結果検証: OK');
    console.log('   - ログキャプチャ: OK');
    console.log('   - スクリーンショット: OK');
    
    return { success: true };
    
  } catch (error) {
    console.error('\n❌ E2E基盤の実装可能性検証: 失敗');
    console.error('エラー:', error.message);
    if (error.stack) {
      console.error('スタック:', error.stack);
    }
    return { success: false, error: error.message };
    
  } finally {
    // クリーンアップ
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Browser close error:', e.message);
      }
    }
    
    if (electronProcess) {
      try {
        electronProcess.kill();
      } catch (e) {
        console.error('Process kill error:', e.message);
      }
    }
    
    console.log('\n🧹 クリーンアップ完了');
  }
}

// 実行
testE2EProof().then(result => {
  if (result.success) {
    console.log('\n✅ すべての検証が完了しました');
    process.exit(0);
  } else {
    console.log('\n❌ 検証に失敗しました');
    process.exit(1);
  }
}).catch(err => {
  console.error('\n❌ 実行中にエラーが発生しました:', err.message);
  process.exit(1);
});
