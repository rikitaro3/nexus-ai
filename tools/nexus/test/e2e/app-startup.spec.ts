import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

test.describe('App Startup', () => {
  test('should start without preload errors', async ({}, testInfo) => {
    // 一時ディレクトリを作成
    const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
    
    try {
      const electronApp = await electron.launch({
        args: ['dist/src/main/main.js'],
        env: {
          ...process.env,
          ELECTRON_USER_DATA_DIR: tmpUserData,
          NODE_ENV: 'test',
        },
      });

      // mainプロセス側でのuserData確認
      const appPath = await electronApp.evaluate(async ({ app }) => {
        return app.getPath('userData');
      });
      console.log('App userData:', appPath);
      expect(appPath).toBe(tmpUserData);

      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // アニメーション無効化
      await page.addStyleTag({ 
        content: `* { transition: none !important; animation: none !important; }` 
      });
      
      // 時刻固定（オプション）
      await page.addInitScript(() => {
        const fixed = 1730000000000;
        Date.now = () => fixed;
      });

      // APIが利用可能になるまで待機
      await page.waitForFunction(() => {
        return typeof (window as any).yaml !== 'undefined' && 
               typeof (window as any).docs !== 'undefined';
      }, { timeout: 10000 });

      // Verify preload APIs are available
      const apisAvailable = await page.evaluate(() => {
        return {
          docs: typeof (window as any).docs !== 'undefined',
          tasks: typeof (window as any).tasks !== 'undefined',
          yaml: typeof (window as any).yaml !== 'undefined',
          settings: typeof (window as any).settings !== 'undefined',
          env: typeof (window as any).env !== 'undefined'
        };
      });

      console.log('APIs available:', apisAvailable);

      expect(apisAvailable.docs).toBe(true);
      expect(apisAvailable.tasks).toBe(true);
      expect(apisAvailable.yaml).toBe(true);
      expect(apisAvailable.settings).toBe(true);
      expect(apisAvailable.env).toBe(true);

      await electronApp.close();
      
      // アプリが完全に終了するまで少し待機してからクリーンアップ
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      // クリーンアップ（エラーは無視）
      try {
        fs.rmSync(tmpUserData, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to cleanup tmp dir:', e);
      }
    }
  });
  
  test('should load YAML context file successfully', async ({}) => {
    const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
    
    try {
      const electronApp = await electron.launch({
        args: ['dist/src/main/main.js'],
        env: {
          ...process.env,
          ELECTRON_USER_DATA_DIR: tmpUserData,
          NODE_ENV: 'test',
        },
      });

      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // アニメーション無効化
      await page.addStyleTag({ 
        content: `* { transition: none !important; animation: none !important; }` 
      });

      // APIが利用可能になるまで待機
      await page.waitForFunction(() => {
        return typeof (window as any).yaml !== 'undefined';
      }, { timeout: 10000 });

      // Test YAML parsing
      const yamlTest = await page.evaluate(async () => {
        const testYaml = 'version: "1.0"\ntest: true';
        try {
          const result = await (window as any).yaml.load(testYaml);
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      });

      console.log('YAML test result:', yamlTest);
      expect(yamlTest.success).toBe(true);
      expect(yamlTest.data).toHaveProperty('version', '1.0');
      expect(yamlTest.data).toHaveProperty('test', true);

      await electronApp.close();
      
      // アプリが完全に終了するまで少し待機してからクリーンアップ
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      // クリーンアップ（エラーは無視）
      try {
        fs.rmSync(tmpUserData, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to cleanup tmp dir:', e);
      }
    }
  });
});
