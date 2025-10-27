// Nexus E2E Test for Tree View
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(__dirname, 'test-e2e.log');
let logMessages = [];

function log(msg) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${msg}`;
  logMessages.push(message);
  console.log(message);
  fs.appendFileSync(LOG_FILE, message + '\n');
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testTreeView() {
  log('=== Nexus Tree View E2E Test ===');
  
  return new Promise((resolve, reject) => {
    // Try to find electron executable
    const os = require('os');
    let electronCmd = 'electron';
    const electronPath = path.join(appRoot, 'node_modules', '.bin', 'electron');
    const electronCmdPath = os.platform() === 'win32' ? electronPath + '.cmd' : electronPath;
    if (require('fs').existsSync(electronCmdPath)) {
      electronCmd = electronCmdPath;
      log(`Using electron from: ${electronCmd}`);
    } else if (require('fs').existsSync(electronPath)) {
      electronCmd = electronPath;
      log(`Using electron from: ${electronPath}`);
    }
    
    const electron = spawn(electronCmd, ['.'], {
      cwd: appRoot,
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    electron.stdout.on('data', (data) => {
      output += data.toString();
      log(`STDOUT: ${data.toString().trim()}`);
    });
    
    electron.stderr.on('data', (data) => {
      errorOutput += data.toString();
      log(`STDERR: ${data.toString().trim()}`);
    });
    
    electron.on('close', (code) => {
      log(`Electron exited with code ${code}`);
      log(`Output length: ${output.length}, Error length: ${errorOutput.length}`);
      
      // Parse TEST_RESULT from console output
      const testResultMatch = output.match(/TEST_RESULT: ({[\s\S]*?})/);
      let testResult = null;
      if (testResultMatch) {
        try {
          testResult = JSON.parse(testResultMatch[1]);
          log('Found test result in output');
          log(`- Nodes: ${testResult.nodesCount}`);
          log(`- Root nodes: ${testResult.rootNodesCount}`);
          log(`- Direction: ${testResult.direction}`);
          
          // Check gate results
          let totalViolations = 0;
          for (const [gateId, violations] of Object.entries(testResult.gateResults)) {
            totalViolations += violations.length;
            if (violations.length > 0) {
              log(`- Gate ${gateId}: ${violations.length} violations`);
            }
          }
          log(`- Total violations: ${totalViolations}`);
        } catch (e) {
          log(`Failed to parse test result: ${e.message}`);
        }
      }
      
      const hasTreeError = errorOutput.includes('tree') || output.includes('tree');
      const hasError = errorOutput.includes('ERROR');
      
      log(`Test Summary:`);
      log(`- Has tree-related output: ${hasTreeError}`);
      log(`- Has errors: ${hasError}`);
      log(`- Exit code: ${code}`);
      log(`- Test result available: ${testResult !== null}`);
      
      resolve({ code, hasTreeError, hasError, testResult, output, errorOutput });
    });
    
    electron.on('error', (err) => {
      log(`Failed to start Electron: ${err.message}`);
      reject(err);
    });
    
    // Wait 10 seconds then kill
    setTimeout(() => {
      log('Killing Electron process...');
      electron.kill();
      resolve({ code: -1, output, errorOutput });
    }, 10000);
  });
}

// Run test
log('Starting Nexus E2E Test...');
testTreeView().then(result => {
  log(`Test completed. Result: ${JSON.stringify(result, null, 2)}`);
  process.exit(0);
}).catch(err => {
  log(`Test failed: ${err.message}`);
  process.exit(1);
});

