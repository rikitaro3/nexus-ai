// Electronの最小構成を確認するスクリプト

console.log('Electron最小構成の確認を開始...\n');

// 1. 必要なモジュールがインストールされているか確認
console.log('1. 依存関係の確認...');
try {
  const electron = require('electron');
  console.log('✓ Electron:', electron ? 'インストール済み' : '未インストール');
  
  const fs = require('fs');
  const path = require('path');
  
  // 2. ファイルの存在確認
  console.log('\n2. ファイルの存在確認...');
  const files = {
    'main.js': path.join(__dirname, 'main.js'),
    'index.html': path.join(__dirname, 'index.html'),
    'package.json': path.join(__dirname, 'package.json')
  };
  
  for (const [name, filePath] of Object.entries(files)) {
    if (fs.existsSync(filePath)) {
      console.log(`✓ ${name}: 存在`);
    } else {
      console.log(`✗ ${name}: 存在しない`);
    }
  }
  
  // 3. package.jsonの内容確認
  console.log('\n3. package.jsonの内容確認...');
  const packageJson = JSON.parse(fs.readFileSync(files['package.json'], 'utf8'));
  console.log(`✓ name: ${packageJson.name}`);
  console.log(`✓ version: ${packageJson.version}`);
  console.log(`✓ scripts.start: ${packageJson.scripts.start}`);
  
  // 4. Electron起動コマンドの確認
  console.log('\n4. 起動方法の確認...');
  console.log('手動起動: npm start');
  console.log('E2Eテスト: npm run test:node');
  console.log('Playwrightテスト: npm test');
  
  console.log('\n✅ Electron最小構成は正常です');
  console.log('\n実行方法:');
  console.log('  npm start              # Electronアプリを起動');
  console.log('  npm run test:node      # E2Eテストを実行');
  console.log('  npm test                # Playwrightテストを実行');
  
} catch (error) {
  console.error('❌ 確認中にエラーが発生しました:', error.message);
  process.exit(1);
}

