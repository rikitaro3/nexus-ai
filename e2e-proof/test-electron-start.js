// Electronアプリが起動できるかを確認するスクリプト

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

console.log('Electronアプリの起動テストを開始...\n');

// 起動方法1: npm start
console.log('方法1: npm start を試行...');
const npmProcess = spawn('npm', ['start'], {
  cwd: __dirname,
  shell: true,
  env: { ...process.env, DISPLAY: ':0' }
});

let hasStarted = false;

npmProcess.stdout.on('data', (data) => {
  console.log('stdout:', data.toString().trim());
});

npmProcess.stderr.on('data', (data) => {
  const text = data.toString().trim();
  if (text.includes('DevTools') || text.includes('window')) {
    hasStarted = true;
    console.log('✓ Electronが起動しました');
    npmProcess.kill();
    setTimeout(() => process.exit(0), 100);
  }
});

npmProcess.on('error', (error) => {
  console.log('✗ npm start でエラー:', error.message);
  process.exit(1);
});

// タイムアウト
setTimeout(() => {
  if (hasStarted) {
    console.log('\n✅ Electronは正常に起動できました');
    npmProcess.kill();
    process.exit(0);
  } else {
    console.log('\n⚠️ タイムアウト: Electronの起動を確認できませんでした');
    npmProcess.kill();
    process.exit(1);
  }
}, 10000);

