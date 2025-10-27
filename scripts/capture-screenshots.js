#!/usr/bin/env node
/*
 * Capture screenshots of the main Nexus UI surfaces so they can be shared in Codex
 * before opening a pull request. The script bootstraps the Electron app with
 * remote debugging enabled, connects via Playwright and iterates through each tab
 * (and Docs sub-modes) to capture deterministic screenshots.
 */
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { createRequire } = require('module');

const REMOTE_DEBUGGING_PORT = 9333;
const WAIT_FOR_APP_MS = 6000;
const VIEWPORT = { width: 1440, height: 900 };

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function timestampedDir(baseDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(baseDir, ts);
}

async function waitForProcessStart(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    const rejectTimer = setTimeout(() => {
      reject(new Error(`Electron process did not start within ${timeoutMs}ms`));
    }, timeoutMs);

    const exitHandler = (code, signal) => {
      clearTimeout(rejectTimer);
      reject(new Error(`Electron process exited early (code=${code}, signal=${signal})`));
    };

    proc.once('exit', exitHandler);

    setTimeout(() => {
      proc.removeListener('exit', exitHandler);
      clearTimeout(rejectTimer);
      resolve();
    }, timeoutMs);
  });
}

async function connectToElectron() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
  const [context] = browser.contexts();
  if (!context) {
    throw new Error('No browser context found when connecting to Electron');
  }
  let [page] = context.pages();
  if (!page) {
    page = await context.newPage();
  }
  await page.setViewportSize(VIEWPORT);
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  await page.waitForSelector('main', { timeout: 20000 });
  return { browser, page };
}

function resolveElectronBinary(appRoot) {
  try {
    const scopedRequire = createRequire(path.join(appRoot, 'package.json'));
    const electronBinary = scopedRequire('electron');
    if (typeof electronBinary !== 'string') {
      throw new Error('Electron module did not return a binary path string');
    }
    return electronBinary;
  } catch (error) {
    throw new Error(`Unable to locate Electron binary. Have you run "npm install"? (${error.message})`);
  }
}

function startElectron(appRoot) {
  const electronCmd = resolveElectronBinary(appRoot);

  const child = spawn(electronCmd, ['.', `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`], {
    cwd: appRoot,
    env: {
      ...process.env,
      E2E_TEST: '1',
      NEXUS_DISABLE_UPDATES: '1'
    },
    stdio: 'inherit'
  });

  return child;
}

async function captureScenario(page, name, prepare, outputDir) {
  if (typeof prepare === 'function') {
    await prepare(page);
  }
  await page.waitForTimeout(800);
  const safeName = name.replace(/[^a-z0-9\-]+/gi, '_');
  const filePath = path.join(outputDir, `${safeName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`📸 Captured ${name} -> ${path.relative(process.cwd(), filePath)}`);
}

async function docsMode(page, mode) {
  await page.click(`.docs-mode-btn[data-mode="${mode}"]`);
  await page.waitForTimeout(400);
}

async function tab(page, tabId) {
  await page.click(`nav.tabs button[data-tab="${tabId}"]`);
  await page.waitForTimeout(400);
}

async function captureScreenshots(appRoot) {
  const outputBase = path.join(appRoot, 'e2e-proof', 'screenshots');
  await ensureDir(outputBase);
  const runOutputDir = timestampedDir(outputBase);
  await ensureDir(runOutputDir);

  console.log(`🗂️  Saving screenshots to ${path.relative(process.cwd(), runOutputDir)}`);

  const electronProcess = startElectron(appRoot);

  try {
    await waitForProcessStart(electronProcess, WAIT_FOR_APP_MS);
    const { browser, page } = await connectToElectron();

    try {
      const scenarios = [
        { name: 'docs-default', prepare: async p => {
          await tab(p, 'docs');
          await docsMode(p, 'docs');
        } },
        { name: 'docs-feats', prepare: async p => {
          await tab(p, 'docs');
          await docsMode(p, 'feats');
          await p.fill('#feat-search', '');
        } },
        { name: 'docs-tree', prepare: async p => {
          await tab(p, 'docs');
          await docsMode(p, 'tree');
        } },
        { name: 'tasks', prepare: async p => {
          await tab(p, 'tasks');
        } },
        { name: 'settings', prepare: async p => {
          await tab(p, 'settings');
        } }
      ];

      for (const scenario of scenarios) {
        await captureScenario(page, scenario.name, scenario.prepare, runOutputDir);
      }
    } finally {
      await browser.close();
    }
  } finally {
    electronProcess.kill();
    await new Promise(resolve => {
      electronProcess.once('exit', () => resolve());
      electronProcess.once('close', () => resolve());
      setTimeout(resolve, 1000);
    });
  }

  console.log('\n✅ Screenshot capture complete. Upload the PNG files above to Codex before opening your PR.');
}

async function main() {
  try {
    const appRoot = path.resolve(__dirname, '..');
    await captureScreenshots(appRoot);
  } catch (error) {
    console.error('❌ Failed to capture screenshots:', error.message);
    process.exitCode = 1;
  }
}

main();
