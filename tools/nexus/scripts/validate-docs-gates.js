#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const VALID_LAYERS = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
const GATE_ORDER = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08', 'TC-01', 'TC-02', 'TC-03', 'TC-04'];
const GATE_METADATA = {
  'DOC-01': { severity: 'error' },
  'DOC-02': { severity: 'error' },
  'DOC-03': { severity: 'error' },
  'DOC-04': { severity: 'warn' },
  'DOC-05': { severity: 'error' },
  'DOC-06': { severity: 'error' },
  'DOC-07': { severity: 'error' },
  'DOC-08': { severity: 'warn' },
  'TC-01': { severity: 'error' },
  'TC-02': { severity: 'warn' },
  'TC-03': { severity: 'warn' },
  'TC-04': { severity: 'error' }
};
const DEFAULT_CONTEXT_CANDIDATES = ['.cursor/context.mdc', 'context.mdc', path.join('tools', 'nexus', 'context.mdc')];

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
  const results = await validateGates(nodes, docStatus, docContents, projectRoot);

  outputResults({
    results,
    contextPath: path.relative(projectRoot, contextPath) || contextPath,
    projectRoot,
    docStatus
  }, args.format);

  const hasErrors = Object.entries(results).some(([gateId, violations]) => {
    const defaultSeverity = GATE_METADATA[gateId]?.severity || 'error';
    return violations.some(v => (v.severity || defaultSeverity) === 'error');
  });

  process.exit(hasErrors ? 1 : 0);
}

function parseArgs(argv) {
  const args = {
    contextPath: null,
    projectRoot: null,
    format: 'table'
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
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-docs-gates.js [options]\n\n` +
    `Options:\n` +
    `  -c, --context <path>        Path to context.mdc (default: .cursor/context.mdc or context.mdc)\n` +
    `  -r, --project-root <path>   Project root for resolving document paths (default: cwd)\n` +
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

function createEmptyResults() {
  const result = {};
  for (const gateId of GATE_ORDER) {
    result[gateId] = [];
  }
  return result;
}

async function validateGates(nodes, docStatus, docContents, projectRoot) {
  const results = createEmptyResults();

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

  for (const [docPath, content] of docContents.entries()) {
    const analysis = analyzeHeadings(docPath, content);
    if (analysis.violations.length > 0) {
      results['DOC-05'].push(...analysis.violations);
    }

    const tocViolations = validateTableOfContents(docPath, content, analysis);
    if (tocViolations.length > 0) {
      results['DOC-06'].push(...tocViolations);
    }

    const namingViolations = validateFileNaming(docPath, nodes.get(docPath));
    if (namingViolations.length > 0) {
      results['DOC-07'].push(...namingViolations);
    }

    const scopeViolations = validateScopeSections(docPath, content, analysis);
    if (scopeViolations.length > 0) {
      results['DOC-08'].push(...scopeViolations);
    }
  }

  const { cases: testCases, errors: testErrors } = await loadTestCases(projectRoot);
  for (const err of testErrors) {
    results['TC-01'].push({ path: err.path, message: err.message, severity: 'error' });
  }

  const tcResults = validateTestCases(testCases);
  for (const gateId of ['TC-01', 'TC-02', 'TC-03', 'TC-04']) {
    if (tcResults[gateId]?.length) {
      results[gateId].push(...tcResults[gateId]);
    }
  }

  return results;
}

function analyzeHeadings(pathKey, content) {
  const lines = content.split('\n');
  const rawHeadings = [];

  const headingRegex = /^(#{2,6})\s+(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const match = headingRegex.exec(lines[i]);
    if (!match) continue;
    const level = match[1].length;
    const rest = match[2].trim();
    const numberMatch = rest.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.*)$/);
    let numbers = null;
    let title = rest;
    if (numberMatch) {
      numbers = numberMatch[1].split('.').map(v => Number(v));
      title = numberMatch[2] || '';
    }
    rawHeadings.push({
      level,
      line: i + 1,
      rest,
      numbers,
      title,
      hasNumbering: Boolean(numbers && numbers.every(n => Number.isFinite(n)))
    });
  }

  const hasNumberedHeading = rawHeadings.some(h => h.hasNumbering && h.level <= 3);
  const violations = [];
  const headings = [];

  for (const heading of rawHeadings) {
    const base = {
      path: pathKey,
      line: heading.line,
      level: heading.level,
      title: heading.title,
      numbers: heading.hasNumbering ? heading.numbers : null,
      hasNumbering: heading.hasNumbering,
      anchorKey: heading.hasNumbering ? sanitizeKey(`${heading.numbers.join('-')}-${heading.title}`) : sanitizeKey(heading.title)
    };
    headings.push(base);
  }

  return {
    headings,
    violations,
    applicable: hasNumberedHeading
  };
}

function validateTableOfContents(pathKey, content, analysis) {
  if (!analysis.applicable) return [];
  const tocSection = extractSection(content, '## 目次', '## ');
  if (!tocSection) return [];

  const linkRegex = /\[(.+?)\]\(#([^)]+)\)/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(tocSection)) !== null) {
    links.push(match[0]);
  }

  if (links.length === 0) {
    return [{ path: pathKey, message: '目次にリンクが定義されていません', severity: 'error' }];
  }

  return [];
}

function validateFileNaming(pathKey, node) {
  const violations = [];
  if (!node) return violations;
  const fileName = path.basename(pathKey);
  if (fileName.toLowerCase() === 'index.mdc') {
    return violations;
  }

  const ext = path.extname(fileName).toLowerCase();
  const layer = node?.layer ? node.layer.toUpperCase() : null;
  const severity = 'error';

  if (!ext) {
    violations.push({ path: pathKey, message: '拡張子が存在しません', severity });
  } else if (ext !== '.mdc' && !(layer === 'ARCH' && ext === '.md')) {
    violations.push({ path: pathKey, message: `無効な拡張子: ${ext}`, severity });
  }

  if (/\s/.test(fileName)) {
    violations.push({ path: pathKey, message: 'ファイル名に空白が含まれています', severity });
  }

  const allowedPattern = /^[\p{L}\p{N}_\-\.]+$/u;
  if (!allowedPattern.test(fileName)) {
    violations.push({ path: pathKey, message: 'ファイル名に使用できない文字が含まれています', severity });
  }

  if (layer === 'PRD' && ext !== '.mdc') {
    violations.push({ path: pathKey, message: 'PRD層のドキュメントは.mdc拡張子を使用してください', severity });
  }

  if (layer === 'QA' && ext !== '.mdc') {
    violations.push({ path: pathKey, message: 'QA層のドキュメントは.mdc拡張子を使用してください', severity });
  }

  return violations;
}

function validateScopeSections(pathKey, content, analysis) {
  const sections = [
    { id: 'in-scope', label: '扱う内容', regex: /^##+\s*(扱う内容|Scope)\s*$/m },
    { id: 'out-of-scope', label: '扱わない内容', regex: /^##+\s*(扱わない内容|Out of Scope)\s*$/m }
  ];

  const violations = [];
  const applicable = analysis.applicable;

  if (!applicable) {
    return violations;
  }

  for (const section of sections) {
    const match = section.regex.exec(content);
    if (!match) continue;
    const startIndex = match.index + match[0].length;
    const rest = content.slice(startIndex);
    const nextSectionMatch = rest.match(/\n##\s+/);
    const block = nextSectionMatch ? rest.slice(0, nextSectionMatch.index) : rest;
    const hasList = /(^|\n)\s*[-\*]\s+/.test(block);
    const hasText = block.trim().length > 0;

    if (!hasText || !hasList) {
      violations.push({
        path: pathKey,
        message: `${section.label} セクションの内容が不足しています`,
        severity: 'warn'
      });
    }
  }

  return violations;
}

async function loadTestCases(projectRoot) {
  const manifestPath = path.join(projectRoot, 'test', 'test-cases.json');
  let specPaths = [];
  try {
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (Array.isArray(manifest.specFiles)) {
      specPaths = manifest.specFiles.filter(p => typeof p === 'string');
    }
  } catch {}

  if (specPaths.length === 0) {
    const fallbackRoot = path.join(projectRoot, 'test');
    specPaths = (await collectSpecFiles(fallbackRoot, fallbackRoot)).map(rel => path.join('test', rel));
  }

  const uniquePaths = [...new Set(specPaths)];
  const cases = [];
  const errors = [];

  for (const specRel of uniquePaths) {
    const absPath = path.isAbsolute(specRel) ? specRel : path.join(projectRoot, specRel);
    try {
      const content = await fs.readFile(absPath, 'utf8');
      cases.push({
        path: path.relative(projectRoot, absPath),
        content
      });
    } catch (error) {
      errors.push({
        path: path.relative(projectRoot, absPath),
        message: `テストケースを読み込めません: ${(error && error.message) || 'unknown error'}`
      });
    }
  }

  return { cases, errors };
}

async function collectSpecFiles(rootDir, currentDir) {
  const entries = [];
  try {
    const items = await fs.readdir(currentDir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) {
        const nested = await collectSpecFiles(rootDir, fullPath);
        entries.push(...nested);
      } else if (item.isFile() && item.name.endsWith('.spec.ts')) {
        entries.push(path.relative(rootDir, fullPath));
      }
    }
  } catch {}
  return entries;
}

function validateTestCases(testCases) {
  const results = {
    'TC-01': [],
    'TC-02': [],
    'TC-03': [],
    'TC-04': []
  };

  const namePattern = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/;
  const dependencyPatterns = [
    /(test|it)\([^)]*\)\s*\.then/si,
    /afterEach[\s\S]*?(test|it)\(/si
  ];

  for (const testCase of testCases) {
    const fileName = path.basename(testCase.path);
    if (!namePattern.test(fileName.toLowerCase())) {
      results['TC-01'].push({
        path: testCase.path,
        message: 'ファイル名が `[分類]-[機能]-[シナリオ].spec.ts` 形式に一致しません',
        severity: 'error'
      });
    }

    for (const pattern of dependencyPatterns) {
      if (pattern.test(testCase.content)) {
        results['TC-02'].push({
          path: testCase.path,
          message: 'テストケース間の依存関係が検出されました',
          severity: 'warn'
        });
        break;
      }
    }

    const tests = [...testCase.content.matchAll(/\b(test|it)\s*\(/g)].length;
    if (tests > 0) {
      const documented = [...testCase.content.matchAll(/\/\*\*[\s\S]*?目的[\s\S]*?期待結果[\s\S]*?\*\//g)].length;
      const coverage = tests === 0 ? 100 : Math.round((documented / tests) * 100);
      if (coverage < 80) {
        results['TC-03'].push({
          path: testCase.path,
          message: `テストドキュメント化率が不足しています (${coverage}% < 80%)`,
          severity: 'warn'
        });
      }
    }

    const hasFixture = /fixtures\//.test(testCase.content);
    const hasSetup = /(beforeAll|test\.beforeAll)/.test(testCase.content);
    const hasTeardown = /(afterAll|test\.afterAll)/.test(testCase.content);
    if (!hasFixture || !hasSetup || !hasTeardown) {
      const missing = [];
      if (!hasFixture) missing.push('fixtures参照');
      if (!hasSetup) missing.push('beforeAll');
      if (!hasTeardown) missing.push('afterAll');
      results['TC-04'].push({
        path: testCase.path,
        message: `テストデータ管理が不十分です (${missing.join(', ')})`,
        severity: 'error'
      });
    }
  }

  return results;
}

function sanitizeKey(value) {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9一-龠ぁ-んァ-ヶー]/g, '');
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

  for (const gateId of GATE_ORDER) {
    const violations = payload.results[gateId] || [];
    const defaultSeverity = GATE_METADATA[gateId]?.severity || 'error';
    const hasError = violations.some(v => (v.severity || defaultSeverity) === 'error');
    const hasViolations = violations.length > 0;
    const status = hasViolations ? (hasError ? 'FAIL' : 'WARN') : 'PASS';
    console.log(`${gateId}: ${status} (${violations.length}件)`);
    for (const violation of violations) {
      const detail = violation.cycle ? violation.cycle.join(' → ') : (violation.link || violation.layer || '');
      console.log(`  - ${violation.path}${detail ? ` — ${detail}` : ''}`);
      console.log(`    ${violation.message}`);
    }
    console.log('');
  }
}

main().catch(error => {
  console.error('Unexpected error during validation:', error);
  process.exit(2);
});
