#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const VALID_LAYERS = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
const DEFAULT_CONTEXT_CANDIDATES = ['.cursor/context.mdc', 'context.mdc', path.join('tools', 'nexus', 'context.mdc')];
const DEFAULT_TEST_ROOTS = ['test', 'tests', path.join('tools', 'nexus', 'test')];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.projectRoot || process.cwd());
  const contextPath = await resolveContextPath(projectRoot, args.contextPath);

  if (!contextPath) {
    console.error('Context file not found. Tried:', args.contextPath ? [args.contextPath] : DEFAULT_CONTEXT_CANDIDATES);
    process.exit(2);
  }

  let contextText;
  try {
    contextText = await fs.readFile(contextPath, 'utf8');
  } catch (error) {
    console.error('Failed to read context file:', error.message);
    process.exit(2);
  }

  const entries = parseContextEntries(contextText);
  if (entries.length === 0) {
    console.error('No entries found in context map.');
    process.exit(2);
  }

  const { nodes, docStatus, docContents } = await parseAllBreadcrumbs(entries, projectRoot);
  const results = validateGates(nodes, docStatus, docContents);

  const { testFiles, fixtureFiles } = await loadTestCaseFiles(projectRoot, args.testRoots);
  const testCaseResults = validateTestCaseGates(testFiles, fixtureFiles);

  for (const [gateId, violations] of Object.entries(testCaseResults)) {
    results[gateId] = violations;
  }

  outputResults({
    results,
    contextPath: path.relative(projectRoot, contextPath) || contextPath,
    projectRoot,
    docStatus
  }, args.format);

  const fatalGateIds = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-05', 'DOC-06', 'DOC-07', 'TC-01', 'TC-04'];
  const hasErrors = fatalGateIds
    .some(gateId => (results[gateId] || []).some(v => v.severity !== 'warn'));

  process.exit(hasErrors ? 1 : 0);
}

function parseArgs(argv) {
  const args = {
    contextPath: null,
    projectRoot: null,
    format: 'table',
    testRoots: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--context' || arg === '-c') {
      args.contextPath = argv[++i];
    } else if (arg.startsWith('--context=')) {
      args.contextPath = arg.split('=')[1];
    } else if (arg === '--project-root' || arg === '-r') {
      args.projectRoot = argv[++i];
    } else if (arg.startsWith('--project-root=')) {
      args.projectRoot = arg.split('=')[1];
    } else if (arg === '--json') {
      args.format = 'json';
    } else if (arg === '--table') {
      args.format = 'table';
    } else if (arg === '--tests' || arg === '--test-root') {
      const value = argv[++i];
      if (typeof value === 'string') {
        args.testRoots.push(...value.split(',').filter(Boolean));
      }
    } else if (arg.startsWith('--test-root=')) {
      const value = arg.split('=')[1];
      if (value) {
        args.testRoots.push(...value.split(',').filter(Boolean));
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

async function resolveTestRoots(projectRoot, overrideRoots) {
  const seen = new Set();
  const roots = [];
  const candidates = (overrideRoots && overrideRoots.length > 0) ? overrideRoots : DEFAULT_TEST_ROOTS;

  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.join(projectRoot, candidate);

    const normalized = path.normalize(absolute);
    if (seen.has(normalized)) continue;

    try {
      const stats = await fs.stat(normalized);
      if (stats.isDirectory()) {
        roots.push(normalized);
        seen.add(normalized);
      }
    } catch {}
  }

  return roots;
}

async function loadTestCaseFiles(projectRoot, overrideRoots) {
  const testRoots = await resolveTestRoots(projectRoot, overrideRoots);
  if (testRoots.length === 0) {
    return { testFiles: [], fixtureFiles: [] };
  }

  const testFiles = [];
  const fixtureFiles = [];

  for (const root of testRoots) {
    await collectTestCaseFiles(root, projectRoot, testFiles, fixtureFiles);
  }

  return { testFiles, fixtureFiles };
}

async function collectTestCaseFiles(currentDir, projectRoot, testFiles, fixtureFiles) {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.svn') continue;
      await collectTestCaseFiles(absolutePath, projectRoot, testFiles, fixtureFiles);
      continue;
    }

    const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');

    if (relativePath.includes('/fixtures/')) {
      fixtureFiles.push(relativePath);
    }

    if (entry.name.endsWith('.spec.ts')) {
      try {
        const content = await fs.readFile(absolutePath, 'utf8');
        testFiles.push({ path: relativePath, content });
      } catch {}
    }
  }
}

function validateTestCaseGates(testFiles, fixtureFiles) {
  const results = {
    'TC-01': [],
    'TC-02': [],
    'TC-03': [],
    'TC-04': []
  };

  for (const file of testFiles) {
    const fileName = path.basename(file.path);
    const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+){2,}\.spec\.ts$/;
    if (!namePattern.test(fileName)) {
      results['TC-01'].push({
        path: file.path,
        message: 'テストケースファイル名が命名規則に準拠していません',
        severity: 'error'
      });
    }

    if (hasTestCaseDependency(file.content)) {
      results['TC-02'].push({
        path: file.path,
        message: 'テストケース間に依存関係が検出されました',
        severity: 'warn'
      });
    }

    const documentation = evaluateTestDocumentation(file.content);
    if (!documentation.valid) {
      results['TC-03'].push({
        path: file.path,
        message: documentation.message,
        severity: 'warn'
      });
    }

    const dataManagement = evaluateTestDataManagement(file.content, fixtureFiles);
    if (!dataManagement.valid) {
      results['TC-04'].push({
        path: file.path,
        message: dataManagement.message,
        severity: 'error'
      });
    }
  }

  return results;
}

function hasTestCaseDependency(content) {
  const blockPatterns = [
    /afterEach\s*\([^)]*\)\s*\{[\s\S]*?(?:test|it)\(/i,
    /beforeAll\s*\([^)]*\)\s*\{[\s\S]*?(?:test|it)\(/i
  ];
  if (blockPatterns.some(pattern => pattern.test(content))) {
    return true;
  }

  const testVarRegex = /const\s+([A-Za-z0-9_$]+)\s*=\s*(?:await\s*)?(?:test|it)\s*\(/g;
  const referencedVars = new Set();
  let match;
  while ((match = testVarRegex.exec(content)) !== null) {
    referencedVars.add(match[1]);
  }

  for (const variable of referencedVars) {
    const dependencyPattern = new RegExp(`${variable}\\s*\\.then\\s*\\(`);
    if (dependencyPattern.test(content)) {
      return true;
    }
  }

  return false;
}

function evaluateTestDocumentation(content) {
  const commentPattern = /\/\*\*[\s\S]*?(?:目的|purpose)[\s\S]*?(?:期待結果|expected)[\s\S]*?\*\//gi;
  const documented = (content.match(commentPattern) || []).length;

  const testPattern = /\b(?:test|it)\s*\(/gi;
  const totalTests = (content.match(testPattern) || []).length;

  if (totalTests === 0) {
    return { valid: true, coverage: 100 };
  }

  const coverage = (documented / totalTests) * 100;
  if (coverage < 80) {
    return {
      valid: false,
      coverage,
      message: `テストドキュメント化率が${Math.round(coverage)}%です（目標: 80%）`
    };
  }

  return { valid: true, coverage };
}

function evaluateTestDataManagement(content, fixtureFiles) {
  const hasFixtureDir = fixtureFiles.length > 0;
  const referencesFixture = /fixtures[\\/]/i.test(content);
  const hasSetup = /(beforeAll|setup)\s*\(/i.test(content);
  const hasTeardown = /(afterAll|teardown)\s*\(/i.test(content);

  const issues = [];
  if (!hasFixtureDir) {
    issues.push('fixtures/ ディレクトリが見つかりません');
  }
  if (!referencesFixture) {
    issues.push('テストでfixtures/配下のデータを参照していません');
  }
  if (!hasSetup) {
    issues.push('beforeAll/setup が実装されていません');
  }
  if (!hasTeardown) {
    issues.push('afterAll/teardown が実装されていません');
  }

  if (issues.length > 0) {
    return { valid: false, message: issues.join('、') };
  }

  return { valid: true };
}

function printHelp() {
  console.log(`Usage: node scripts/validate-docs-gates.js [options]\n\n` +
    `Options:\n` +
    `  -c, --context <path>        Path to context.mdc (default: .cursor/context.mdc or context.mdc)\n` +
    `  -r, --project-root <path>   Project root for resolving document paths (default: cwd)\n` +
    `      --tests <paths>         Comma-separated test root directories for TC gates\n` +
    `      --json                  Output results as JSON\n` +
    `      --table                 Output results as a human-readable table (default)\n` +
    `  -h, --help                  Show this help message\n`);
}

async function resolveContextPath(projectRoot, overridePath) {
  if (overridePath) {
    const candidate = path.isAbsolute(overridePath) ? overridePath : path.join(projectRoot, overridePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
    return null;
  }

  for (const rel of DEFAULT_CONTEXT_CANDIDATES) {
    const candidate = path.join(projectRoot, rel);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function parseContextEntries(text) {
  const entries = [];
  const section = extractSection(text, '## Context Map', '## ');
  if (!section) return entries;

  const lines = section.split('\n');
  let currentCategory = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const catMatch = line.match(/^###\s+(.+)$/);
    if (catMatch) {
      currentCategory = catMatch[1];
      continue;
    }

    const itemMatch = line.match(/^[-\*]\s+([^\s].*?)\s+…\s+(.*)$/);
    if (itemMatch && currentCategory) {
      entries.push({
        category: currentCategory,
        path: itemMatch[1].trim(),
        description: itemMatch[2].trim()
      });
    }
  }

  return entries;
}

async function parseAllBreadcrumbs(entries, projectRoot) {
  const nodes = new Map();
  const docStatus = new Map();
  const docContents = new Map();

  for (const entry of entries) {
    const relPath = entry.path;
    const target = path.resolve(projectRoot, relPath);

    let content;
    try {
      content = await fs.readFile(target, 'utf8');
    } catch (error) {
      docStatus.set(relPath, { status: 'read-error', message: error.message });
      continue;
    }

    docContents.set(relPath, content);

    const breadcrumbs = extractBreadcrumbs(content);
    if (!breadcrumbs) {
      docStatus.set(relPath, { status: 'missing-breadcrumbs' });
      continue;
    }

    const layer = extractField(breadcrumbs, 'Layer');
    const upstreamRaw = extractField(breadcrumbs, 'Upstream');
    const downstreamRaw = extractField(breadcrumbs, 'Downstream');
    const upstream = splitLinks(upstreamRaw);
    const downstream = splitLinks(downstreamRaw);

    nodes.set(relPath, {
      path: relPath,
      layer,
      upstream,
      downstream
    });

    if (!layer && upstream.length === 0 && downstream.length === 0) {
      docStatus.set(relPath, { status: 'missing-breadcrumbs' });
    } else if (!docStatus.has(relPath)) {
      docStatus.set(relPath, { status: 'ok' });
    }
  }

  return { nodes, docStatus, docContents };
}

function validateGates(nodes, docStatus, docContents) {
  const results = {
    'DOC-01': [],
    'DOC-02': [],
    'DOC-03': [],
    'DOC-04': [],
    'DOC-05': [],
    'DOC-06': [],
    'DOC-07': [],
    'DOC-08': []
  };

  for (const [pathKey, status] of docStatus.entries()) {
    if (status.status === 'missing-breadcrumbs') {
      results['DOC-01'].push({ path: pathKey, message: 'Breadcrumbsブロックが見つかりません', severity: 'error' });
    } else if (status.status === 'read-error') {
      results['DOC-01'].push({ path: pathKey, message: `ドキュメントを読み込めません: ${status.message}`, severity: 'error' });
    }
  }

  for (const [pathKey, node] of nodes.entries()) {
    if (node.layer && !VALID_LAYERS.includes(node.layer.toUpperCase())) {
      results['DOC-02'].push({ path: pathKey, layer: node.layer, message: `無効なLayer: ${node.layer}`, severity: 'error' });
    }

    for (const upPath of node.upstream) {
      if (!nodes.has(upPath)) {
        results['DOC-03'].push({ path: pathKey, link: upPath, message: `Upstreamパスが存在しません: ${upPath}`, severity: 'error' });
      }
    }

    for (const downPath of node.downstream) {
      if (!nodes.has(downPath)) {
        results['DOC-03'].push({ path: pathKey, link: downPath, message: `Downstreamパスが存在しません: ${downPath}`, severity: 'error' });
      }
    }
  }

  const cycles = detectCycles(nodes);
  results['DOC-04'] = cycles.map(cycle => ({ ...cycle, severity: 'warn' }));

  const headingViolations = validateHeadings(docContents);
  results['DOC-05'].push(...headingViolations);

  const tocViolations = validateTableOfContents(docContents);
  results['DOC-06'].push(...tocViolations);

  const namingViolations = validateNamingRules(docContents, docStatus, nodes);
  results['DOC-07'].push(...namingViolations);

  const scopeViolations = validateScopeSections(docContents);
  results['DOC-08'].push(...scopeViolations.map(v => ({ ...v, severity: 'warn' })));

  return results;
}

function detectCycles(nodes) {
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  function dfs(nodePath, stack) {
    if (recStack.has(nodePath)) {
      const cyclePath = [...stack, nodePath];
      cycles.push({ path: nodePath, cycle: cyclePath, message: `循環参照: ${cyclePath.join(' → ')}` });
      return;
    }

    if (visited.has(nodePath)) return;
    visited.add(nodePath);
    recStack.add(nodePath);
    stack.push(nodePath);

    const node = nodes.get(nodePath);
    if (node) {
      for (const downPath of node.downstream) {
        dfs(downPath, [...stack]);
      }
    }
    recStack.delete(nodePath);
  }

  for (const [pathKey] of nodes.entries()) {
    if (!visited.has(pathKey)) {
      dfs(pathKey, []);
    }
  }

  return cycles;
}

function validateHeadings(docContents) {
  const violations = [];

  for (const [pathKey, content] of docContents.entries()) {
    const headings = extractHeadings(content);
    const numberingState = [];

    for (const heading of headings) {
      if (heading.level < 2 || heading.level > 3) continue;
      const text = heading.text.trim();
      if (/^目次$/i.test(text)) continue;

      const match = text.match(/^(\d+(?:\.\d+)*)\.\s+.+$/);
      if (!match) {
        violations.push({
          path: pathKey,
          heading: text,
          message: `章番号形式ではありません: "${text}"`,
          severity: 'error'
        });
        continue;
      }

      const numbers = match[1].split('.').map(num => parseInt(num, 10));
      const depth = heading.level - 2;

      if (numbers.length !== depth + 1 || numbers.some(Number.isNaN)) {
        violations.push({
          path: pathKey,
          heading: text,
          message: `見出しレベルと章番号の整合が取れていません: "${text}"`,
          severity: 'error'
        });
        continue;
      }

      let prefixMismatch = false;
      for (let i = 0; i < depth; i++) {
        if (typeof numberingState[i] === 'undefined') {
          prefixMismatch = true;
          break;
        }
        if (numberingState[i] !== numbers[i]) {
          prefixMismatch = true;
          break;
        }
      }

      if (prefixMismatch) {
        violations.push({
          path: pathKey,
          heading: text,
          message: `上位レベルの章番号が連番になっていません: "${text}"`,
          severity: 'error'
        });
        continue;
      }

      const previous = numberingState[depth];
      const expected = typeof previous === 'undefined'
        ? (depth === 0 ? numbers[depth] : 1)
        : previous + 1;

      if (numbers[depth] !== expected) {
        violations.push({
          path: pathKey,
          heading: text,
          message: `章番号は ${expected} を期待しました (実際: ${numbers[depth]})`,
          severity: 'error'
        });
        continue;
      }

      numberingState[depth] = numbers[depth];
      numberingState.length = depth + 1;
    }
  }

  return violations;
}

function validateTableOfContents(docContents) {
  const violations = [];

  for (const [pathKey, content] of docContents.entries()) {
    const tocSection = extractSectionByTitle(content, [/^目次$/i]);
    if (!tocSection) {
      violations.push({ path: pathKey, message: '## 目次 セクションが見つかりません', severity: 'error' });
      continue;
    }

    const links = Array.from(tocSection.content.matchAll(/\[(.+?)\]\(#(.+?)\)/g));
    if (links.length === 0) {
      violations.push({ path: pathKey, message: '目次に有効なリンクが存在しません', severity: 'error' });
      continue;
    }

    const headings = extractHeadings(content);
    const headingSlugs = new Set(headings.map(h => slugifyHeading(h.text)).filter(Boolean));
    for (const [, , anchor] of links) {
      const normalized = anchor.trim().toLowerCase();
      if (!headingSlugs.has(normalized)) {
        violations.push({
          path: pathKey,
          link: anchor,
          message: `目次リンクのアンカーが本文に存在しません: #${anchor}`,
          severity: 'error'
        });
      }
    }
  }

  return violations;
}

function validateNamingRules(docContents, docStatus, nodes) {
  const violations = [];
  const allPaths = new Set([...docContents.keys(), ...docStatus.keys()]);

  for (const pathKey of allPaths) {
    if (!pathKey) continue;
    const baseName = path.basename(pathKey);
    if (!baseName) continue;
    if (baseName.toLowerCase() === 'index.mdc') continue;

    const lower = baseName.toLowerCase();
    if (!lower.endsWith('.mdc') && !lower.endsWith('.md')) {
      violations.push({
        path: pathKey,
        message: `ファイル拡張子が無効です (.mdc/.md のみ許可): ${baseName}`,
        severity: 'error'
      });
      continue;
    }

    const layer = inferLayerFromPath(pathKey, nodes);
    const pattern = selectNamingPattern(layer);
    if (!pattern.test(baseName)) {
      violations.push({
        path: pathKey,
        message: `命名規則に準拠していません (${layer || 'GENERAL'}): ${baseName}`,
        severity: 'error'
      });
    }
  }

  return violations;
}

function validateScopeSections(docContents) {
  const violations = [];

  for (const [pathKey, content] of docContents.entries()) {
    let hasInclude = false;
    let hasExclude = false;

    const includeSection = extractSectionByTitle(content, [/^(扱う内容|in\s*scope)$/i]);
    if (includeSection) {
      hasInclude = hasListWithContent(includeSection.content);
    }

    const excludeSection = extractSectionByTitle(content, [/^(扱わない内容|out\s*of\s*scope|非スコープ)$/i]);
    if (excludeSection) {
      hasExclude = hasListWithContent(excludeSection.content);
    }

    if (!hasInclude || !hasExclude) {
      const scopeSection = extractSectionByTitle(content, [/^scope$/i]);
      if (scopeSection) {
        const bullets = extractListLines(scopeSection.content);
        const includeKeywords = bullets.some(line => /(含まれる|in\s*scope|対象)/i.test(line));
        const excludeKeywords = bullets.some(line => /(含まれない|out\s*of\s*scope|除外|非対象)/i.test(line));
        if (bullets.length > 0 && includeKeywords && excludeKeywords) {
          hasInclude = true;
          hasExclude = true;
        }
      }
    }

    if (!hasInclude || !hasExclude) {
      violations.push({
        path: pathKey,
        message: 'Scopeセクションに「扱う内容」と「扱わない内容」が明示されていません',
        severity: 'warn'
      });
    }
  }

  return violations;
}

function extractHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }

  return headings;
}

function extractSectionByTitle(content, titlePatterns) {
  const lines = content.split('\n');
  let startIndex = -1;
  let startLevel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(#{2,6})\s+(.*)$/);
    if (!match) continue;

    const headingText = match[2].trim();
    if (titlePatterns.some(pattern => pattern.test(headingText))) {
      startIndex = i;
      startLevel = match[1].length;
      break;
    }
  }

  if (startIndex === -1) return null;

  const sectionLines = [];
  for (let j = startIndex + 1; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    const match = trimmed.match(/^(#{1,6})\s+/);
    if (match && match[1].length <= startLevel) break;
    sectionLines.push(line);
  }

  return { level: startLevel, content: sectionLines.join('\n') };
}

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\u3000/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s\-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferLayerFromPath(pathKey, nodes) {
  const normalized = pathKey.replace(/\\/g, '/');
  if (nodes.has(pathKey) && nodes.get(pathKey).layer) {
    return nodes.get(pathKey).layer.toUpperCase();
  }

  const segments = normalized.split('/');
  const docsIndex = segments.indexOf('docs');
  if (docsIndex !== -1 && segments.length > docsIndex + 1) {
    return segments[docsIndex + 1].toUpperCase();
  }

  return null;
}

function selectNamingPattern(layer) {
  switch (layer) {
    case 'PRD':
      return /^PRD_[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
    case 'ARCH':
      return /^[A-Z0-9][A-Za-z0-9_-]*\.(mdc|md)$/;
    case 'QA':
      return /^[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
    case 'UX':
    case 'API':
    case 'DATA':
    case 'DEVELOPMENT':
    case 'STRATEGY':
      return /^[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
    default:
      return /^[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
  }
}

function hasListWithContent(sectionText) {
  const bullets = extractListLines(sectionText);
  return bullets.some(line => line.trim().length > 2);
}

function extractListLines(sectionText) {
  const lines = sectionText.split('\n');
  return lines.filter(line => line.trim().match(/^[-*\d]+[.)]?\s+.+/));
}

function extractSection(text, startHeader, stopHeaderPrefix = '## ') {
  const startIdx = text.indexOf(startHeader);
  if (startIdx === -1) return '';

  const after = text.slice(startIdx);
  const rest = after.slice(startHeader.length);
  if (!stopHeaderPrefix) return after.trim();

  const escaped = stopHeaderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\n${escaped}`);
  const match = regex.exec(rest);
  if (!match) return after.trim();

  return after.slice(0, startHeader.length + match.index).trim();
}

function extractBreadcrumbs(text) {
  const match = text.match(/>\s*Breadcrumbs[\s\S]*?(?=\n#|\n##|$)/);
  return match ? match[0] : '';
}

function extractField(breadcrumbs, field) {
  const regex = new RegExp(`>\\s*${field}:\\s*(.*)`);
  const match = regex.exec(breadcrumbs);
  return match ? match[1].trim() : '';
}

function splitLinks(value) {
  if (!value) return [];
  return value
    .split(/[,、]/)
    .map(s => s.trim())
    .filter(s => s && s.toUpperCase() !== 'N/A');
}

function outputResults(payload, format) {
  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('Docs Quality Gates Validation');
  console.log('Project Root:', payload.projectRoot);
  console.log('Context File:', payload.contextPath);
  console.log('');

  const order = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08', 'TC-01', 'TC-02', 'TC-03', 'TC-04'];
  const warnGates = new Set(['DOC-04', 'DOC-08', 'TC-02', 'TC-03']);
  for (const gateId of order) {
    const violations = payload.results[gateId] || [];
    const status = violations.length === 0
      ? 'PASS'
      : (warnGates.has(gateId) ? 'WARN' : 'FAIL');
    console.log(`${gateId}: ${status} (${violations.length}件)`);
    for (const violation of violations) {
      const detail = violation.cycle
        ? violation.cycle.join(' → ')
        : (violation.link || violation.layer || violation.heading || '');
      console.log(`  - ${violation.path}${detail ? ` — ${detail}` : ''}`);
      console.log(`    ${violation.message}`);
    }
    console.log('');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unexpected error during validation:', error);
    process.exit(2);
  });
}

module.exports = {
  main,
  parseArgs,
  resolveContextPath,
  parseContextEntries,
  parseAllBreadcrumbs,
  validateGates,
  validateHeadings,
  validateTableOfContents,
  validateNamingRules,
  validateScopeSections,
  detectCycles,
  loadTestCaseFiles,
  validateTestCaseGates,
  resolveTestRoots,
  evaluateTestDocumentation,
  evaluateTestDataManagement,
  hasTestCaseDependency,
  outputResults
};
