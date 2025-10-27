import * as fs from 'fs';
import * as path from 'path';

// getRepoRoot() を直接インポートするのではなく、テスト用のラッパーを作成
let testEnv: NodeJS.ProcessEnv = {};

// 環境変数のモック
Object.defineProperty(process, 'env', {
  get() {
    return testEnv;
  },
  set(value) {
    testEnv = value;
  }
});

describe('getRepoRoot の優先順位', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    // テスト前のクリーンアップ
    delete process.env.NEXUS_PROJECT_ROOT;
    testEnv = { ...originalEnv };
    // グローバル変数をリセット（モック用）
    jest.resetModules();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  test('環境変数 NEXUS_PROJECT_ROOT が最優先', () => {
    process.env.NEXUS_PROJECT_ROOT = 'C:\\test\\env\\path';
    
    // getRepoRoot() を動的にインポート
    const security = require('../security');
    const result = security.getRepoRoot();
    
    expect(result).toBe('C:\\test\\env\\path');
  });

  test('グローバル設定が第2優先', () => {
    // 環境変数なし
    delete process.env.NEXUS_PROJECT_ROOT;
    
    const security = require('../security');
    security.setGlobalProjectRoot('C:\\test\\global\\path');
    
    const result = security.getRepoRoot();
    
    expect(result).toBe('C:\\test\\global\\path');
  });

  test('カスタム設定が第3優先（存在する場合）', () => {
    // 環境変数なし、グローバルなし
    delete process.env.NEXUS_PROJECT_ROOT;
    
    // 一時的なディレクトリを作成してテスト
    const tempDir = path.join(__dirname, 'temp-test-custom');
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const security = require('../security');
      security.setCustomProjectRoot(tempDir);
      
      const result = security.getRepoRoot();
      
      expect(result).toBe(tempDir);
    } finally {
      // クリーンアップ
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    }
  });

  test('全て未設定の場合、フォールバックを使用', () => {
    delete process.env.NEXUS_PROJECT_ROOT;
    
    const security = require('../security');
    
    // __dirname からの相対パスが計算される
    const result = security.getRepoRoot();
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});
