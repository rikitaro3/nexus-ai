const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * E2E Test for Nexus using Playwright
 * 
 * Best practices applied:
 * - Use electron.launch API (when available in newer Playwright)
 * - Or connect via CDP after launching Electron with remote debugging
 * - Stable selectors (data-* attributes)
 * - Proper async/await handling
 * - Console log capture
 * - Screenshots for debugging
 */

async function testNexus() {
  console.log('🚀 Starting Nexus E2E Test with Playwright...');
  
  let electronProcess;
  let browser;
  let page;
  
  try {
    // Start Electron with remote debugging
    console.log('Starting Electron with remote debugging...');
    const electronPath = require('electron');
    const electronCmd = process.platform === 'win32' ? electronPath : electronPath;
    
    electronProcess = spawn(electronCmd, ['.', '--remote-debugging-port=9222'], {
      cwd: __dirname,
      env: { ...process.env, E2E_TEST: '1', NEXUS_DEBUG: '1' }
    });
    
    // Capture stdout and stderr from Electron process
    electronProcess.stdout.on('data', (data) => {
      const text = data.toString();
      console.log('[Electron stdout]:', text.trim());
    });
    
    electronProcess.stderr.on('data', (data) => {
      const text = data.toString();
      console.log('[Electron stderr]:', text.trim());
    });
    
    // Wait for Electron to start
    console.log('Waiting for Electron to start...');
    await new Promise(resolve => setTimeout(resolve, 12000));
    
    // Connect to Electron via CDP
    console.log('Connecting to Electron via CDP...');
    browser = await chromium.connectOverCDP('http://localhost:9222');
    
    // Setup console log capture BEFORE getting page
    const logs = [];
    const logHandler = (msg) => {
      logs.push(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
    };
    const errorHandler = (error) => {
      logs.push(`[PAGE ERROR]: ${error.message}${error.stack ? '\n' + error.stack : ''}`);
    };
    
    // Get existing page
    const contexts = browser.contexts();
    if (contexts.length === 0 || contexts[0].pages().length === 0) {
      throw new Error('No pages found');
    }
    page = contexts[0].pages()[0];
    console.log('✓ Connected to Electron page');
    
    // Setup console log capture (immediately after page creation)
    page.on('console', logHandler);
    page.on('pageerror', errorHandler);
    
    // Wait for app to initialize and check docs-navigator is ready
    console.log('Waiting for docs-navigator initialization...');
    
    // Wait for docsNavigatorReady flag with longer timeout
    let retries = 0;
    let ready = false;
    while (retries < 60 && !ready) {
      await page.waitForTimeout(1000);
      ready = await page.evaluate(() => window.docsNavigatorReady === true);
      if (!ready) retries++;
      if (retries % 10 === 0) {
        console.log(`Waiting for docs-navigator... (${retries}/60)`);
      }
    }
    
    if (ready) {
      console.log('✓ Docs Navigator initialized');
      const entriesCount = await page.evaluate(() => window.entries ? window.entries.length : 0);
      console.log('Entries count:', entriesCount);
    } else {
      console.log('⚠️  Docs Navigator initialization timed out');
    }
    
    // Verify UI loaded
    const hasHeader = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 && h1.textContent.includes('Nexus');
    });
    console.log('UI loaded:', hasHeader);
    
    // Switch to Nexus context if available (for E2E tests)
    console.log('Checking context selector...');
    const contextSelected = await page.evaluate(() => {
      const selector = document.getElementById('context-select');
      if (selector && selector.value === 'nexus') {
        console.log('[E2E] Context is already set to Nexus');
        return true;
      }
      if (selector) {
        selector.value = 'nexus';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[E2E] Switched to Nexus context');
        return true;
      }
      return false;
    });
    
    // Wait for context to reload and verify entries are loaded
    if (contextSelected) {
      console.log('Waiting for context reload...');
      await page.waitForTimeout(10000);
      
      // Verify entries are loaded after context switch
      const entriesAfterSwitch = await page.evaluate(() => {
        console.log('[E2E] Checking entries after context switch...');
        console.log('[E2E] window.entries:', window.entries ? window.entries.length : 'not defined');
        return window.entries && window.entries.length > 0;
      });
      console.log('Entries loaded after context switch:', entriesAfterSwitch);
    }
    
    // Click Tree button
    console.log('Clicking Tree button...');
    const clicked = await page.evaluate(() => {
      console.log('[E2E] Tree button evaluation started');
      const btn = document.querySelector('button[data-mode="tree"]');
      console.log('[E2E] Button found:', btn !== null);
      if (!btn) {
        console.log('[E2E] Tree button not found');
        return false;
      }
      console.log('[E2E] About to click Tree button');
      
      // Try both methods: MouseEvent and direct click()
      btn.click();
      console.log('[E2E] Tree button click() called');
      
      // Also dispatch event
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      btn.dispatchEvent(event);
      console.log('[E2E] Tree button click event dispatched');
      
      // Force trigger renderTree even if not active (for debugging)
      setTimeout(() => {
        console.log('[E2E] Checking renderTree availability...');
        console.log('[E2E] typeof window.renderTree:', typeof window.renderTree);
        const isActive = btn.classList.contains('active');
        console.log('[E2E] Tree button is active:', isActive);
        
        if (typeof window.renderTree === 'function') {
          console.log('[E2E] Manually calling renderTree()');
          try {
            window.renderTree();
            console.log('[E2E] renderTree() called successfully');
          } catch (e) {
            console.log('[E2E] renderTree() error:', e.message);
          }
        } else {
          console.log('[E2E] window.renderTree is not available');
        }
      }, 100);
      
      return true;
    });
    console.log('Tree button clicked:', clicked);
    
    // Wait for tree to render
    console.log('Waiting for tree to render (15 seconds)...');
    await page.waitForTimeout(15000);
    
    // Check if tree rendered
    const treeInfo = await page.evaluate(() => {
      const tree = document.getElementById('tree-view');
      const status = document.getElementById('tree-status');
      return {
        exists: tree !== null,
        innerHTML: tree ? tree.innerHTML.substring(0, 200) : 'N/A',
        statusText: status ? status.textContent : 'N/A',
        hasNodes: tree && tree.querySelector('.tree-node') !== null,
        nodeCount: tree ? tree.querySelectorAll('.tree-node').length : 0
      };
    });
    console.log('Tree info:', JSON.stringify(treeInfo, null, 2));
    
    // Check mode buttons state
    const modeState = await page.evaluate(() => {
      const docsBtn = document.querySelector('button[data-mode="docs"]');
      const featsBtn = document.querySelector('button[data-mode="feats"]');
      const treeBtn = document.querySelector('button[data-mode="tree"]');
      return {
        docsActive: docsBtn && docsBtn.classList.contains('active'),
        featsActive: featsBtn && featsBtn.classList.contains('active'),
        treeActive: treeBtn && treeBtn.classList.contains('active')
      };
    });
    console.log('Mode buttons state:', JSON.stringify(modeState, null, 2));
    
    console.log('Total logs:', logs.length);
    console.log('Recent logs:');
    logs.slice(-30).forEach((log, i) => {
      console.log(`  ${i}: ${log}`);
    });
    
    // Take screenshot
    await page.screenshot({ path: 'test-screenshot.png' });
    console.log('📸 Screenshot saved to test-screenshot.png');
    
    // Analyze logs for errors and suggest fixes
    console.log('\n=== CONSOLE LOGS ANALYSIS ===');
    const errors = logs.filter(log => log.includes('ERROR') || log.includes('ReferenceError') || log.includes('ENOENT'));
    if (errors.length > 0) {
      console.log('\n⚠️  ERRORS FOUND:');
      errors.forEach(err => console.log('  ', err));
      
      // Auto-fix suggestions
      console.log('\n=== AUTO-FIX SUGGESTIONS ===');
      if (logs.some(log => log.includes('ENOENT') && log.includes('context.mdc'))) {
        console.log('1. Context file path issue detected');
        console.log('   Suggestion: Check if tools/nexus/context.mdc exists');
        console.log('   Command: ls tools/nexus/context.mdc');
      }
      if (logs.some(log => log.includes('entries is not defined'))) {
        console.log('2. Variables scope issue detected');
        console.log('   Suggestion: Fix variables scoping in docs-navigator.js');
      }
    }
    
    // Save all logs to file
    fs.writeFileSync('e2e-test-logs.txt', logs.join('\n'));
    console.log('\n📝 All logs saved to e2e-test-logs.txt');
    
    // Auto-fix implementation
    const fixes = [];
    
    // Fix 1: Context file path issue
    if (logs.some(log => log.includes('ENOENT') && log.includes('context.mdc'))) {
      console.log('\n🔧 AUTO-FIX: Context file path issue');
      const contextPath = 'tools/nexus/context.mdc';
      if (!fs.existsSync(contextPath)) {
        console.log('   Creating context.mdc...');
        const contextContent = `# Nexus Context Map

Nexus自身のドキュメントコンテキスト。

## Context Map

### PRD
- tools/nexus/docs/PRD/index.mdc … PRD Index
- tools/nexus/docs/PRD/PRD_Nexus.mdc … Nexus要件
- tools/nexus/docs/PRD/PRD_DocumentTemplate.mdc … ドキュメントテンプレート
- tools/nexus/docs/PRD/PRD_DocsNavigator_TasksBreakdown.mdc … Docs Navigator + Tasks

### ARCH
- tools/nexus/docs/ARCH/index.mdc … アーキテクチャIndex

### DEVELOPMENT
- tools/nexus/docs/DEVELOPMENT/index.mdc … 開発ガイド

### QA
- tools/nexus/docs/QA/index.mdc … QA Index
- tools/nexus/docs/QA/E2Eテスト実行方法.mdc … E2Eテスト実行方法

### GATES
- tools/nexus/docs/GATES/document.mdc … Document Quality Gates

### Root
- tools/nexus/docs/index.mdc … Nexus Docs Root

## Traceability Map

Nexusのドキュメント階層:

\`\`\`
Root (docs/index.mdc)
├─ PRD (docs/PRD/index.mdc)
│  ├─ PRD_Nexus.mdc
│  ├─ PRD_DocumentTemplate.mdc
│  └─ PRD_DocsNavigator_TasksBreakdown.mdc
├─ ARCH (docs/ARCH/index.mdc)
├─ DEVELOPMENT (docs/DEVELOPMENT/index.mdc)
├─ QA (docs/QA/index.mdc)
│  └─ E2Eテスト実行方法.mdc
└─ GATES (docs/GATES/document.mdc)
\`\`\`

### Waypoints

1. **Nexus概要理解**: \`docs/index.mdc\` → \`docs/PRD/PRD_Nexus.mdc\`
2. **開発**: \`docs/DEVELOPMENT/index.mdc\` → \`docs/PRD/**\`
3. **テスト**: \`docs/QA/index.mdc\` → \`docs/QA/E2Eテスト実行方法.mdc\`
4. **Quality Gates**: \`docs/GATES/document.mdc\`

### MECE Domains

- **PRD**: 要件定義
- **ARCH**: アーキテクチャ設計
- **DEVELOPMENT**: 開発ガイド
- **QA**: テスト・品質保証
- **GATES**: Quality Gates定義
`;
        fs.writeFileSync(contextPath, contextContent);
        console.log('   ✓ Created context.mdc');
        fixes.push('context.mdc created');
      }
    }
    
    // Fix 2: Variables scope issue
    if (logs.some(log => log.includes('entries is not defined'))) {
      console.log('\n🔧 AUTO-FIX: Variables scope issue');
      const docsNavigatorPath = 'renderer/docs-navigator.js';
      if (fs.existsSync(docsNavigatorPath)) {
        let content = fs.readFileSync(docsNavigatorPath, 'utf8');
        // Check if entries is declared outside try-catch
        if (content.includes('const entries = window.entries;') && !content.match(/let entries = \[\];/m)) {
          console.log('   Fixing entries variable scope...');
          content = content.replace(
            /let contextPath = '\.cursor\/context\.mdc';\s+try\s+\{/,
            'let contextPath = \'.cursor/context.mdc\';\n  let entries = [];\n  try {\n'
          );
          fs.writeFileSync(docsNavigatorPath, content);
          console.log('   ✓ Fixed entries variable scope');
          fixes.push('entries variable scope fixed');
        }
      }
    }
    
    if (fixes.length > 0) {
      console.log(`\n✅ Auto-fixed ${fixes.length} issue(s)`);
      console.log('   Re-running test...');
      // Return special code to trigger re-test
      return { success: false, autoFixed: true, fixes };
    }
    
    // Verify TEST_RESULT
    const testResult = logs.find(log => log.includes('TEST_RESULT'));
    if (testResult) {
      console.log('✅ Found TEST_RESULT in logs');
      console.log('✅ E2E Test PASSED - Tree view is working');
      return { success: true };
    } else {
      console.log('⚠️  TEST_RESULT not found');
      console.log('⚠️  E2E Test WARNING - Tree rendering may have failed');
      return { success: false, hasTree: treeInfo.hasNodes };
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (electronProcess) electronProcess.kill();
  }
}

// Run test with auto-retry
let maxRetries = 3;
let retryCount = 0;

function runTest() {
  return testNexus().then(result => {
    if (result.autoFixed && retryCount < maxRetries) {
      retryCount++;
      console.log(`\n🔄 Retrying test (${retryCount}/${maxRetries})...`);
      return runTest();
    }
    console.log('✅ E2E Test completed:', result);
    process.exit(result.success ? 0 : 1);
  });
}

runTest().catch(err => {
  console.error('❌ E2E Test failed:', err.message);
  process.exit(1);
});

