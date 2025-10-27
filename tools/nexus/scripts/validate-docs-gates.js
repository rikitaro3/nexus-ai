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

function analyzeHeadings(pathKey, content) {
  const lines = content.split('\n');
  const headingRegex = /^(#{2,6})\s+(.+)$/;
  const rawHeadings = [];

  for (let i = 0; i < lines.length; i++) {
    const match = headingRegex.exec(lines[i]);
    if (!match) continue;

    const level = match[1].length;
    if (level > 3) continue;
    const rest = match[2].trim();
    const numberMatch = rest.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.*)$/);
    rawHeadings.push({
      level,
      line: i + 1,
      numbers: numberMatch ? numberMatch[1].split('.').map(v => Number(v)) : null,
      title: numberMatch ? numberMatch[2].trim() : rest,
      raw: rest
    });
  }

  const hasNumbering = rawHeadings.some(h => Array.isArray(h.numbers));
  const counters = [0, 0, 0, 0, 0];
  const headings = [];
  const violations = [];

  for (const heading of rawHeadings) {
    const depth = heading.level - 2;
    const numbers = heading.numbers;

    if (!numbers) {
      const isTocHeading = /^目次$/i.test(heading.raw) || /^table of contents$/i.test(heading.raw);
      headings.push(createHeadingMeta(pathKey, heading.level, null, heading.raw));
      if (hasNumbering && !isTocHeading) {
        violations.push({
          path: pathKey,
          line: heading.line,
          message: `見出しに章番号がありません: ${heading.raw}`,
          severity: 'error'
        });
      }
      continue;
    }

    if (numbers.some(n => !Number.isFinite(n))) {
      violations.push({
        path: pathKey,
        line: heading.line,
        message: `章番号が数値ではありません: ${heading.raw}`,
        severity: 'error'
      });
      headings.push(createHeadingMeta(pathKey, heading.level, numbers, heading.title));
      continue;
    }

    if (depth >= 0 && numbers.length !== depth + 1) {
      violations.push({
        path: pathKey,
        line: heading.line,
        message: `章番号の桁数が見出し階層と一致しません (期待: ${depth + 1}桁)`,
        severity: 'error'
      });
    }

    let parentMismatch = false;
    for (let idx = 0; idx < depth; idx++) {
      if (numbers[idx] !== counters[idx]) {
        parentMismatch = true;
        break;
      }
    }
    if (parentMismatch) {
      violations.push({
        path: pathKey,
        line: heading.line,
        message: '章番号の親階層が直前の番号と一致しません',
        severity: 'error'
      });
    }

    if (depth >= 0) {
      const expected = counters[depth] === 0 ? numbers[depth] : counters[depth] + 1;
      if (counters[depth] !== 0 && numbers[depth] !== expected) {
        violations.push({
          path: pathKey,
          line: heading.line,
          message: `章番号の連番が不正です (期待: ${expected}, 実際: ${numbers[depth]})`,
          severity: 'error'
        });
      }

      counters[depth] = numbers[depth];
      for (let j = depth + 1; j < counters.length; j++) {
        counters[j] = 0;
      }
    }

    headings.push(createHeadingMeta(pathKey, heading.level, numbers, heading.title));
  }

  return { headings, violations, applicable: hasNumbering };
}

function createHeadingMeta(pathKey, level, numbers, title) {
  return {
    path: pathKey,
    level,
    numbers: numbers || null,
    title,
    anchorKey: numbers ? `${numbers.join('')}-${slugify(title)}` : slugify(title)
  };
}

function slugify(value) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-ー一-龠ぁ-んァ-ヶ]/gu, '');
}

function validateTableOfContents(pathKey, content, analysis) {
  if (!analysis.applicable) return [];
  const tocSection = extractSection(content, '## 目次', '## ');
  if (!tocSection) {
    return [{ path: pathKey, message: '目次セクション (## 目次) が見つかりません', severity: 'error' }];
  }

  const linkRegex = /\[(.+?)\]\(#([^)]+)\)/g;
  const anchors = new Set(analysis.headings.filter(h => h.numbers).map(h => h.anchorKey));
  const missing = [];
  let hasLink = false;
  let match;
  while ((match = linkRegex.exec(tocSection)) !== null) {
    hasLink = true;
    const anchor = match[2];
    if (!anchors.has(anchor)) {
      missing.push(anchor);
    }
  }

  if (!hasLink) {
    return [{ path: pathKey, message: '目次にリンクが定義されていません', severity: 'error' }];
  }

  if (missing.length > 0) {
    return [{
      path: pathKey,
      message: `目次リンクのアンカーが存在しません: ${missing.join(', ')}`,
      severity: 'error'
    }];
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
  const baseName = fileName.replace(ext, '');
  const severity = 'error';

  if (!ext) {
    violations.push({ path: pathKey, message: '拡張子が存在しません', severity });
  } else if (ext !== '.mdc' && !(node.layer?.toUpperCase() === 'ARCH' && ext === '.md')) {
    violations.push({ path: pathKey, message: `無効な拡張子: ${ext}`, severity });
  }

  if (/\s/.test(fileName)) {
    violations.push({ path: pathKey, message: 'ファイル名に空白が含まれています', severity });
  }

  const basePattern = /^[\p{L}\p{N}][\p{L}\p{N}_\-]*$/u;
  if (!basePattern.test(baseName)) {
    violations.push({ path: pathKey, message: 'ファイル名は英数字または日本語で始まり、英数字/ハイフン/アンダースコアのみ使用してください', severity });
  }

  const layer = node.layer ? node.layer.toUpperCase() : null;
  if (layer === 'PRD' && !/^PRD_[A-Za-z0-9_-]+$/.test(baseName)) {
    violations.push({ path: pathKey, message: 'PRD層のファイル名は PRD_ で始まる必要があります', severity });
  }

  if (layer === 'QA' && ext !== '.mdc') {
    violations.push({ path: pathKey, message: 'QA層のドキュメントは .mdc 拡張子を使用してください', severity });
  }

  return violations;
}

function validateScopeSections(pathKey, content, analysis) {
  if (!analysis.applicable) return [];

  const sections = [
    { label: '扱う内容', regex: /^##+\s*(扱う内容|Scope)\s*$/m },
    { label: '扱わない内容', regex: /^##+\s*(扱わない内容|Out of Scope)\s*$/m }
  ];

  const violations = [];
  for (const section of sections) {
    const match = section.regex.exec(content);
    if (!match) {
      violations.push({ path: pathKey, message: `${section.label} セクションが見つかりません`, severity: 'warn' });
      continue;
    }

    const startIndex = match.index + match[0].length;
    const rest = content.slice(startIndex);
    const nextSection = rest.search(/\n##\s+/);
    const block = nextSection === -1 ? rest : rest.slice(0, nextSection);
    const hasBullet = /(^|\n)\s*[-\*]\s+/.test(block);
    const hasText = block.trim().length > 0;
    if (!hasBullet || !hasText) {
      violations.push({ path: pathKey, message: `${section.label} セクションの内容が不足しています`, severity: 'warn' });
    }
  }

  return violations;
}

async function loadTestCases(projectRoot) {
  const manifestPath = path.join(projectRoot, 'test', 'test-cases.json');
  const errors = [];
  let specFiles = [];

  try {
    const manifestRaw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (Array.isArray(manifest.specFiles)) {
      specFiles = manifest.specFiles.filter(p => typeof p === 'string');
    }
  } catch (error) {
    errors.push({ path: path.relative(projectRoot, manifestPath), message: `テストマニフェストを読み込めません: ${error.message}` });
  }

  if (specFiles.length === 0) {
    const fallbackRoot = path.join(projectRoot, 'test');
    specFiles = (await collectSpecFiles(fallbackRoot, fallbackRoot)).map(rel => path.join('test', rel));
  }

  const uniquePaths = [...new Set(specFiles)];
  const cases = [];
  for (const relPath of uniquePaths) {
    const absPath = path.join(projectRoot, relPath);
    try {
      const content = await fs.readFile(absPath, 'utf8');
      cases.push({ path: relPath, content });
    } catch (error) {
      errors.push({ path: relPath, message: `テストファイルを読み込めません: ${error.message}` });
    }
  }

  return { cases, errors };
}

async function collectSpecFiles(dir, baseDir) {
  let results = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectSpecFiles(abs, baseDir);
      results = results.concat(nested);
      continue;
    }
    if (/\.spec\.(ts|js)$/.test(entry.name)) {
      results.push(path.relative(baseDir, abs));
    }
  }
  return results;
}

function validateTestCases(testCases) {
  const results = {
    'TC-01': [],
    'TC-02': [],
    'TC-03': [],
    'TC-04': []
  };

  for (const testCase of testCases) {
    const fileName = path.basename(testCase.path);
    const namingPattern = /^[a-z0-9]+(?:-[a-z0-9]+)+\.spec\.ts$/;
    if (!namingPattern.test(fileName)) {
      results['TC-01'].push({
        path: testCase.path,
        message: 'テストケースファイル名が命名規則に準拠していません (例: docs-navigator-tree-smoke.spec.ts)',
        severity: 'error'
      });
    }

    const dependencyPatterns = [
      /test\.describe\.serial/,
      /\btest\s*\([^)]*\)\s*\.then/
    ];
    if (dependencyPatterns.some(re => re.test(testCase.content))) {
      results['TC-02'].push({
        path: testCase.path,
        message: 'テストケース間に依存関係が存在する可能性があります (serial describe や test(...).then(...) の使用を見直してください)',
        severity: 'warn'
      });
    }

    const testCount = [...testCase.content.matchAll(/\b(test|it)\s*\(/g)].length;
    const documentedCount = (testCase.content.match(/\/\*\*[\s\S]*?目的[\s\S]*?期待結果[\s\S]*?\*\//g) || []).length;
    if (testCount > 0) {
      const coverage = Math.round((documentedCount / testCount) * 100);
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
