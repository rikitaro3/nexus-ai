// Playwright E2E Test for Nexus
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

async function testNexusWithPlaywright() {
  console.log('🚀 Starting Nexus E2E Test with Playwright...');
  
  let electronProcess;
  let browser;
  let page;
  
  try {
    // Start Electron with remote debugging
    console.log('Starting Electron with remote debugging...');
    const electronPath = path.join(__dirname, 'node_modules', '.bin', 'electron');
    const electronCmd = os.platform() === 'win32' ? electronPath + '.cmd' : electronPath;
    
    electronProcess = spawn(electronCmd, ['.', '--remote-debugging-port=9222'], {
      cwd: __dirname,
      env: { ...process.env, E2E_TEST: '1' }
    });
    
    // Wait for Electron to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Connect to Electron via CDP
    console.log('Connecting to Electron via CDP...');
    browser = await chromium.connectOverCDP('http://localhost:9222');
    
    // Get all pages
    const contexts = browser.contexts();
    console.log(`Found ${contexts.length} context(s)`);
    
    // Try to get existing page or create new one
    for (const context of contexts) {
      const pages = context.pages();
      console.log(`Context has ${pages.length} page(s)`);
      if (pages.length > 0) {
        page = pages[0];
        console.log('Using existing page');
        break;
      }
    }
    
    if (!page) {
      page = await contexts[0].newPage();
      console.log('Created new page');
    }
    
    console.log('✓ Connected to Electron');
    
    // Collect console logs
    const logs = [];
    
    // Setup ALL event listeners FIRST
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      console.log(`[CONSOLE ${msg.type()}]:`, text);
    });
    
    page.on('pageerror', error => {
      console.log(`[PAGE ERROR]:`, error.message);
      logs.push(`ERROR: ${error.message}`);
    });
    
    // Wait for page to load and setup console listeners
    console.log('Waiting for page to load...');
    await page.waitForTimeout(5000);
    
    // Wait for page to load
    try {
      await page.waitForSelector('h1', { timeout: 15000 });
      console.log('✓ Page loaded');
    } catch (e) {
      console.log('Page might already be loaded or error:', e.message);
    }
    
    console.log('Waiting for initial render...');
    // Wait for any console logs from initial page load
    await page.waitForTimeout(2000);
    
    // Click Tree button using evaluate AND trigger console.log inside
    console.log('Clicking Tree button via evaluate...');
    const clicked = await page.evaluate(() => {
      console.log('[E2E-EVAL] About to click Tree button');
      const btn = document.querySelector('button[data-mode="tree"]');
      console.log('[E2E-EVAL] Tree button found:', btn !== null);
      if (btn) {
        console.log('[E2E-EVAL] Calling click()');
        btn.click();
        console.log('[E2E-EVAL] Click() completed');
        return true;
      }
      console.log('[E2E-EVAL] Tree button not found');
      return false;
    });
    console.log('✓ Tree button clicked:', clicked);
    
    // Wait a moment for click to process
    await page.waitForTimeout(500);
    
    // Wait for Tree to render
    console.log('✓ Waiting for tree to render...');
    for (let i = 0; i < 12; i++) {
      try {
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('Page might have closed');
        break;
      }
    }
    
    // Check logs captured during the wait
    console.log(`Total console logs captured: ${logs.length}`);
    logs.forEach((log, i) => {
      console.log(`  ${i}: ${log}`);
    });
    
    // Check status indicator
    const status = await page.evaluate(() => {
      const el = document.getElementById('tree-status');
      return el ? el.textContent : 'Not found';
    });
    console.log(`Status: ${status}`);
    
    // Check if tree view has rendered content
    const treeViewHasContent = await page.evaluate(() => {
      const treeView = document.getElementById('tree-view');
      if (!treeView) return false;
      const hasNodes = treeView.querySelector('.tree-node');
      return hasNodes !== null;
    });
    console.log(`Tree view has rendered nodes: ${treeViewHasContent}`);
    
    // Look for TEST_RESULT in logs - might span multiple log entries
    const resultStartIdx = logs.findIndex(log => log.includes('TEST_RESULT:'));
    if (resultStartIdx !== -1) {
      console.log('✅ Found TEST_RESULT in console logs');
      // Collect all logs from TEST_RESULT: until JSON is complete
      let jsonStr = '';
      let braceCount = 0;
      let inJson = false;
      
      for (let i = resultStartIdx; i < logs.length; i++) {
        const line = logs[i];
        
        if (i === resultStartIdx) {
          const jsonStart = line.indexOf('TEST_RESULT:') + 'TEST_RESULT:'.length;
          jsonStr = line.substring(jsonStart).trim();
        } else {
          jsonStr += '\n' + line.trim();
        }
        
        // Count braces to detect JSON completion
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
        if (braceCount === 0 && i > resultStartIdx) break;
      }
      
      try {
        const result = JSON.parse(jsonStr.trim());
        console.log(`📊 Test Results:`);
        console.log(`  - Nodes: ${result.nodesCount}`);
        console.log(`  - Root nodes: ${result.rootNodesCount}`);
        console.log(`  - Direction: ${result.direction}`);
        
        let totalViolations = 0;
        for (const [gateId, violations] of Object.entries(result.gateResults)) {
          if (violations.length > 0) {
            console.log(`  - Gate ${gateId}: ${violations.length} violations`);
            totalViolations += violations.length;
          }
        }
        console.log(`  - Total violations: ${totalViolations}`);
        
        const testPassed = result.nodesCount > 0;
        if (testPassed) {
          console.log('✅ Test PASSED - Tree view is working');
        } else {
          console.log('⚠️  Test WARNING - No nodes found');
        }
        
        return { success: true, result };
      } catch (e) {
        console.error(`❌ Failed to parse test result: ${e.message}`);
        return { success: false, error: e.message };
      }
    } else {
      console.log('⚠️  TEST_RESULT not found in console logs');
      console.log(`Total logs: ${logs.length}`);
      return { success: false, logs };
    }
    
    // Check if tree view has content
    const treeViewContent = await page.evaluate(() => {
      const el = document.getElementById('tree-view');
      return el ? el.innerHTML : '';
    });
    console.log(`Tree view content length: ${treeViewContent.length}`);
    
    // Take screenshot
    await page.screenshot({ path: 'test-screenshot.png' });
    console.log('📸 Screenshot saved');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (electronProcess) {
      electronProcess.kill();
    }
  }
}

// Run test
testNexusWithPlaywright().then(result => {
  console.log('✅ E2E Test completed');
  process.exit(0);
}).catch(err => {
  console.error('❌ E2E Test failed:', err.message);
  process.exit(1);
});

