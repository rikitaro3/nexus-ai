#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const matter = require('gray-matter');
const { unified } = require('unified');
const remarkParse = require('remark-parse');
const remarkFrontmatter = require('remark-frontmatter');
const remarkGfm = require('remark-gfm');
const { visit } = require('unist-util-visit');
const toString = require('mdast-util-to-string');

const VALID_LAYERS = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
const TEST_CASE_CATEGORIES = ['docs-navigator', 'tree-view', 'tasks', 'integration'];
const DEFAULT_CONTEXT_CANDIDATES = ['.cursor/context.mdc', 'context.mdc', path.join('tools', 'nexus', 'context.mdc')];
const TEST_CASE_ROOT_CANDIDATES = [
  'test',
  'tests',
  path.join('tools', 'nexus', 'test'),
  path.join('tools', 'nexus', 'tests')
];
const DOC_GATE_IDS = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08'];
const TEST_GATE_IDS = ['TC-01', 'TC-02', 'TC-03', 'TC-04'];
const ALL_GATE_IDS = [...DOC_GATE_IDS, ...TEST_GATE_IDS];

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
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

  const { nodes, docStatus, docRecords } = await parseAllBreadcrumbs(entries, projectRoot);
  const results = createEmptyGateResults();
  validateDocumentGates(nodes, docStatus, docRecords, results);
  await validateTestCaseGates(projectRoot, results, { testRoots: args.testRoots });

  outputResults({
    results,
    contextPath: path.relative(projectRoot, contextPath) || contextPath,
    projectRoot,
    docStatus
  }, args.format);

  const hasErrors = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-05', 'DOC-06', 'DOC-07', 'TC-01', 'TC-04']
    .some(gateId => results[gateId].some(v => v.severity !== 'warn'));

  process.exit(hasErrors ? 1 : 0);
}

function parseArgs(argv = []) {
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
    } else if (arg === '--tests' || arg === '--test-root' || arg === '-t') {
      addTestRoots(args, argv[++i]);
    } else if (arg.startsWith('--tests=')) {
      addTestRoots(args, arg.split('=')[1]);
    } else if (arg.startsWith('--test-root=')) {
      addTestRoots(args, arg.split('=')[1]);
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

function addTestRoots(args, raw) {
  if (!raw) return;
  const values = Array.isArray(raw) ? raw : String(raw);
  const parts = (typeof values === 'string' ? values.split(',') : values)
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) {
    args.testRoots.push(...parts);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/validate-docs-gates.js [options]\n\n` +
    `Options:\n` +
    `  -c, --context <path>        Path to context.mdc (default: .cursor/context.mdc or context.mdc)\n` +
    `  -r, --project-root <path>   Project root for resolving document paths (default: cwd)\n` +
    `  -t, --tests <paths>         Comma-separated test roots relative to the project root\n` +
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
  const docRecords = new Map();

  for (const entry of entries) {
    const relPath = entry.path;
    const target = path.resolve(projectRoot, relPath);

    let raw;
    try {
      raw = await fs.readFile(target, 'utf8');
    } catch (error) {
      docStatus.set(relPath, { status: 'read-error', message: error.message });
      continue;
    }

    let parsed;
    try {
      parsed = matter(raw);
    } catch (error) {
      docStatus.set(relPath, { status: 'invalid-frontmatter', message: error.message });
      continue;
    }

    const frontMatter = normalizeFrontMatter(parsed.data || {});
    const ast = buildMarkdownAst(parsed.content);
    const title = extractDocumentTitle(ast);

    docRecords.set(relPath, {
      content: parsed.content,
      frontMatter,
      ast,
      title
    });

    if (!frontMatter || Object.keys(frontMatter).length === 0) {
      docStatus.set(relPath, { status: 'missing-frontmatter' });
      continue;
    }

    const { layer, upstream, downstream } = frontMatter;

    nodes.set(relPath, {
      path: relPath,
      layer,
      upstream,
      downstream,
      frontMatter
    });

    if (!layer && upstream.length === 0 && downstream.length === 0) {
      docStatus.set(relPath, { status: 'incomplete-frontmatter' });
    } else if (!docStatus.has(relPath)) {
      docStatus.set(relPath, { status: 'ok' });
    }
  }

  return { nodes, docStatus, docRecords };
}

function createEmptyGateResults() {
  return ALL_GATE_IDS.reduce((acc, gateId) => {
    acc[gateId] = [];
    return acc;
  }, {});
}

function validateDocumentGates(nodes, docStatus, docRecords, results) {
  if (!results || typeof results !== 'object') {
    throw new Error('validateDocumentGates requires a results object');
  }

  for (const [pathKey, status] of docStatus.entries()) {
    if (status.status === 'missing-frontmatter') {
      results['DOC-01'].push({ path: pathKey, message: 'YAMLフロントマターが見つかりません', severity: 'error' });
    } else if (status.status === 'invalid-frontmatter') {
      results['DOC-01'].push({ path: pathKey, message: `YAMLフロントマターを解析できません: ${status.message}`, severity: 'error' });
    } else if (status.status === 'incomplete-frontmatter') {
      results['DOC-01'].push({ path: pathKey, message: 'フロントマターにLayer/Upstream/Downstreamが設定されていません', severity: 'error' });
    } else if (status.status === 'read-error') {
      results['DOC-01'].push({ path: pathKey, message: `ドキュメントを読み込めません: ${status.message}`, severity: 'error' });
    }
  }

  for (const [pathKey, node] of nodes.entries()) {
    if (!node.layer) {
      results['DOC-02'].push({ path: pathKey, message: 'layerが未設定です', severity: 'error' });
    } else if (!VALID_LAYERS.includes(node.layer.toUpperCase())) {
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

      const record = docRecords.get(pathKey);
      if (record) {
        const frontTitle = typeof record.frontMatter.title === 'string' ? record.frontMatter.title.trim() : '';
        if (frontTitle && record.title && frontTitle !== record.title) {
          results['DOC-01'].push({
            path: pathKey,
            message: `フロントマターのtitleと本文のH1が一致しません (title: "${frontTitle}", H1: "${record.title}")`,
            severity: 'error'
          });
        }
      }
    }

  const cycles = detectCycles(nodes);
  results['DOC-04'] = cycles.map(cycle => ({ ...cycle, severity: 'warn' }));

  const headingViolations = validateHeadings(docRecords);
  results['DOC-05'].push(...headingViolations);

  const tocViolations = validateTableOfContents(docRecords);
  results['DOC-06'].push(...tocViolations);

  const namingViolations = validateNamingRules(docRecords, docStatus, nodes);
  results['DOC-07'].push(...namingViolations);

  const scopeViolations = validateScopeSections(docRecords);
  results['DOC-08'].push(...scopeViolations.map(v => ({ ...v, severity: 'warn' })));
}

async function validateTestCaseGates(projectRoot, results, options = {}) {
  const candidates = Array.isArray(options.testRoots) && options.testRoots.length > 0
    ? options.testRoots
    : TEST_CASE_ROOT_CANDIDATES;
  const testArtifacts = await collectTestCaseArtifacts(projectRoot, candidates);
  const testCases = await loadTestCaseSources(testArtifacts.testCases);

  for (const tc of testCases) {
    const naming = validateTestCaseName(tc.relativePath);
    if (!naming.valid) {
      results['TC-01'].push({
        path: tc.relativePath,
        message: naming.error,
        severity: 'error'
      });
    }

    if (tc.readError) {
      results['TC-01'].push({
        path: tc.relativePath,
        message: `テストケースを読み込めません: ${tc.readError}`,
        severity: 'error'
      });
      continue;
    }

    const independence = validateTestIndependence(tc.content);
    if (!independence.valid) {
      results['TC-02'].push({
        path: tc.relativePath,
        message: independence.error,
        severity: 'warn'
      });
    }

    const documentation = validateTestDocumentation(tc.content);
    if (!documentation.valid) {
      const coverage = Number.isFinite(documentation.coverage)
        ? Math.round(documentation.coverage * 10) / 10
        : 0;
      results['TC-03'].push({
        path: tc.relativePath,
        message: documentation.error || `テストドキュメント化率が${coverage}%です（目標: 80%）`,
        severity: 'warn',
        coverage
      });
    }
  }

  const dataViolations = validateTestDataManagement(testCases, testArtifacts.fixtureDirs, testArtifacts.fixtureFiles);
  results['TC-04'].push(...dataViolations);

  if (testArtifacts.testCases.length === 0) {
    const fallbackRoot = testArtifacts.detectedRoots[0]
      || (Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : 'test');
    results['TC-01'].push({
      path: fallbackRoot,
      message: 'テストケース（*.spec.ts）が検出されませんでした',
      severity: 'warn'
    });
  }

  return results;
}

async function collectTestCaseArtifacts(projectRoot, testRootCandidates = TEST_CASE_ROOT_CANDIDATES) {
  const detectedRoots = [];
  const testCases = [];
  const fixtureDirs = new Set();
  const fixtureFiles = [];

  for (const relRoot of testRootCandidates) {
    const absoluteRoot = path.isAbsolute(relRoot) ? relRoot : path.join(projectRoot, relRoot);
    try {
      const stat = await fs.stat(absoluteRoot);
      if (!stat.isDirectory()) continue;
      const relativeName = path.relative(projectRoot, absoluteRoot) || relRoot;
      detectedRoots.push(relativeName.split(path.sep).join('/'));
    } catch {
      continue;
    }

    await walkTestDirectory(absoluteRoot, async (entryPath, dirent) => {
      if (dirent.isDirectory()) {
        if (dirent.name.toLowerCase() === 'fixtures') {
          fixtureDirs.add(path.relative(projectRoot, entryPath) || dirent.name);
        }
        return;
      }

      if (!dirent.isFile()) return;
      if (entryPath.endsWith('.spec.ts')) {
        testCases.push({
          absolutePath: entryPath,
          relativePath: path.relative(projectRoot, entryPath).split(path.sep).join('/'),
          content: null,
          readError: null
        });
      } else if (entryPath.includes(`${path.sep}fixtures${path.sep}`) || entryPath.includes('/fixtures/')) {
        fixtureFiles.push(path.relative(projectRoot, entryPath).split(path.sep).join('/'));
      }
    });
  }

  return { testCases, fixtureDirs, fixtureFiles, detectedRoots };
}

async function walkTestDirectory(dir, onEntry) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of entries) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      await onEntry(fullPath, dirent);
      await walkTestDirectory(fullPath, onEntry);
    } else {
      await onEntry(fullPath, dirent);
    }
  }
}

async function loadTestCaseSources(testCases) {
  const loaded = [];
  for (const testCase of testCases) {
    const record = { ...testCase };
    try {
      record.content = await fs.readFile(testCase.absolutePath, 'utf8');
    } catch (error) {
      record.readError = error instanceof Error ? error.message : 'unknown error';
    }
    loaded.push(record);
  }
  return loaded;
}

function validateTestCaseName(relativePath) {
  const baseName = path.basename(relativePath);
  const match = /^([a-z0-9-]+)-([a-z0-9-]+)-([a-z0-9-]+)\.spec\.ts$/i.exec(baseName);
  if (!match) {
    return { valid: false, error: 'ファイル名が命名規則に準拠していません ([分類]-[機能]-[シナリオ].spec.ts)' };
  }

  const category = match[1].toLowerCase();
  if (!TEST_CASE_CATEGORIES.includes(category)) {
    return { valid: false, error: `分類が無効です: ${match[1]}（有効: ${TEST_CASE_CATEGORIES.join(', ')}）` };
  }

  if (!match[2] || !match[3]) {
    return { valid: false, error: '分類と機能とシナリオをハイフンで区切って指定してください' };
  }

  return { valid: true };
}

function validateTestIndependence(source) {
  if (!source) return { valid: true };
  const patterns = [
    /\btest\s*\([^)]*\)\s*\.then[\s\S]*?\btest\s*\(/i,
    /\bit\s*\([^)]*\)\s*\.then[\s\S]*?\bit\s*\(/i,
    /afterEach[\s\S]*?(\btest\s*\(|\bit\s*\()/i,
    /beforeAll[\s\S]*?order[\s\S]*?(\btest\s*\(|\bit\s*\()/i
  ];

  for (const pattern of patterns) {
    if (pattern.test(source)) {
      return { valid: false, error: 'テストケース間に依存関係があります' };
    }
  }

  return { valid: true };
}

function validateTestDocumentation(source) {
  if (!source) {
    return { valid: false, coverage: 0, error: 'テストソースが空です' };
  }

  const commentPattern = /\/\*\*[\s\S]*?目的[\s\S]*?期待結果[\s\S]*?\*\//g;
  const testPattern = /(test|it)\s*\(\s*['"](.*?)['"]/g;

  const comments = source.match(commentPattern) || [];
  const tests = [...source.matchAll(testPattern)];
  const totalTests = tests.length;

  if (totalTests === 0) {
    return { valid: true, coverage: 100 };
  }

  const coverage = (comments.length / totalTests) * 100;
  if (coverage < 80) {
    return {
      valid: false,
      coverage,
      error: `テストドキュメント化率が${Math.round(coverage * 10) / 10}%です（目標: 80%）`
    };
  }

  return { valid: true, coverage };
}

function validateTestDataManagement(testCases, fixtureDirs, fixtureFiles) {
  const violations = [];
  const hasFixturesDir = fixtureDirs && fixtureDirs.size > 0;
  const hasFixtureFiles = Array.isArray(fixtureFiles) && fixtureFiles.length > 0;

  if (!hasFixturesDir || !hasFixtureFiles) {
    violations.push({
      path: hasFixturesDir ? Array.from(fixtureDirs)[0] : 'test',
      message: 'fixtures/ディレクトリ内のテストデータが確認できません',
      severity: 'error'
    });
  }

  for (const testCase of testCases) {
    if (testCase.readError || !testCase.content) continue;
    const usesFixtures = /fixtures\//.test(testCase.content) || /fixtures\\/.test(testCase.content);
    if (!usesFixtures) continue;

    const hasSetup = /(setup|beforeAll|beforeEach)\s*\(/i.test(testCase.content);
    const hasTeardown = /(teardown|afterAll|afterEach)\s*\(/i.test(testCase.content);
    if (!hasSetup || !hasTeardown) {
      violations.push({
        path: testCase.relativePath,
        message: 'fixtures/を利用するテストにsetup/teardownが実装されていません',
        severity: 'error'
      });
    }
  }

  return violations;
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

function validateHeadings(docRecords) {
  const violations = [];

  for (const [pathKey, record] of docRecords.entries()) {
    const numberingState = [];
    const headings = collectHeadings(record.ast).filter(h => h.depth >= 2 && h.depth <= 3);

    for (const heading of headings) {
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
      const depth = heading.depth - 2;

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
        if (typeof numberingState[i] === 'undefined' || numberingState[i] !== numbers[i]) {
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

function validateTableOfContents(docRecords) {
  const violations = [];

  for (const [pathKey, record] of docRecords.entries()) {
    const tocSection = findSectionByHeading(record.ast, [/^目次$/i]);
    if (!tocSection) {
      violations.push({ path: pathKey, message: '## 目次 セクションが見つかりません', severity: 'error' });
      continue;
    }

    const links = collectLinksFromSection(tocSection).filter(link => link.url.startsWith('#'));
    if (links.length === 0) {
      violations.push({ path: pathKey, message: '目次に有効なリンクが存在しません', severity: 'error' });
      continue;
    }

    const headingSlugs = new Set(collectHeadings(record.ast).map(h => slugifyHeading(h.text)).filter(Boolean));
    for (const link of links) {
      const normalized = link.url.replace(/^#+/, '').trim().toLowerCase();
      if (!headingSlugs.has(normalized)) {
        violations.push({
          path: pathKey,
          link: link.url,
          message: `目次リンクのアンカーが本文に存在しません: ${link.url}`,
          severity: 'error'
        });
      }
    }
  }

  return violations;
}

function validateNamingRules(docRecords, docStatus, nodes) {
  const violations = [];
  const allPaths = new Set([...docRecords.keys(), ...docStatus.keys()]);

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

function validateScopeSections(docRecords) {
  const violations = [];

  for (const [pathKey, record] of docRecords.entries()) {
    let hasInclude = false;
    let hasExclude = false;

    const includeSection = findSectionByHeading(record.ast, [/^(?:\d+(?:\.\d+)*\.\s*)?(扱う内容|in\s*scope)$/i]);
    if (includeSection) {
      hasInclude = sectionHasListWithContent(includeSection);
    }

    const excludeSection = findSectionByHeading(record.ast, [/^(?:\d+(?:\.\d+)*\.\s*)?(扱わない内容|out\s*of\s*scope|非スコープ)$/i]);
    if (excludeSection) {
      hasExclude = sectionHasListWithContent(excludeSection);
    }

    if (!hasInclude || !hasExclude) {
      const scopeSection = findSectionByHeading(record.ast, [/^(?:\d+(?:\.\d+)*\.\s*)?scope$/i]);
      if (scopeSection) {
        const items = collectListItemTexts(scopeSection);
        const includeKeywords = items.some(text => /(含まれる|in\s*scope|対象)/i.test(text));
        const excludeKeywords = items.some(text => /(含まれない|out\s*of\s*scope|除外|非対象)/i.test(text));
        if (items.length > 0 && includeKeywords && excludeKeywords) {
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

function collectHeadings(ast) {
  const headings = [];
  if (!ast) return headings;
  visit(ast, 'heading', node => {
    headings.push({ depth: node.depth || 0, text: toString(node) || '' });
  });
  return headings;
}

function findSectionByHeading(ast, titlePatterns = []) {
  if (!ast || !Array.isArray(ast.children)) return null;
  const children = ast.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== 'heading') continue;
    const text = toString(node).trim();
    if (!titlePatterns.some(pattern => pattern.test(text))) continue;
    const depth = node.depth || 0;
    const content = [];
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (next.type === 'heading' && (next.depth || 0) <= depth) {
        break;
      }
      content.push(next);
    }
    return { heading: node, depth, content };
  }
  return null;
}

function collectLinksFromSection(section) {
  if (!section) return [];
  const links = [];
  const root = { type: 'root', children: section.content || [] };
  visit(root, 'link', node => {
    links.push({ url: node.url || '', text: toString(node) || '' });
  });
  return links;
}

function sectionHasListWithContent(section) {
  if (!section) return false;
  let hasContent = false;
  const root = { type: 'root', children: section.content || [] };
  visit(root, 'listItem', node => {
    if (!hasContent && toString(node).trim().length > 0) {
      hasContent = true;
    }
  });
  return hasContent;
}

function collectListItemTexts(section) {
  if (!section) return [];
  const items = [];
  const root = { type: 'root', children: section.content || [] };
  visit(root, 'listItem', node => {
    const text = toString(node).trim();
    if (text) items.push(text);
  });
  return items;
}

function buildMarkdownAst(content) {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .parse(content || '');
}

function extractDocumentTitle(ast) {
  if (!ast || !Array.isArray(ast.children)) return '';
  for (const node of ast.children) {
    if (node.type === 'heading' && node.depth === 1) {
      return toString(node).trim();
    }
  }
  return '';
}

function normalizeFrontMatter(data) {
  if (!data || typeof data !== 'object') return {};
  const normalized = { ...data };

  if (typeof normalized.title === 'string') {
    normalized.title = normalized.title.trim();
    if (!normalized.title) delete normalized.title;
  }

  if (typeof normalized.layer === 'string') {
    normalized.layer = normalized.layer.trim();
  } else {
    normalized.layer = '';
  }

  normalized.upstream = normalizeLinkArray(normalized.upstream);
  normalized.downstream = normalizeLinkArray(normalized.downstream);

  return normalized;
}

function normalizeLinkArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item && item.toUpperCase() !== 'N/A');
  }
  if (typeof value === 'string') {
    return splitLinks(value);
  }
  return [];
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

  const warnOnlyGates = new Set(['DOC-04', 'DOC-08', 'TC-02', 'TC-03']);
  for (const gateId of ALL_GATE_IDS) {
    const violations = Array.isArray(payload.results[gateId]) ? payload.results[gateId] : [];
    const status = violations.length === 0
      ? 'PASS'
      : (warnOnlyGates.has(gateId) ? 'WARN' : 'FAIL');
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

const exported = {
  main,
  parseArgs,
  resolveContextPath,
  parseContextEntries,
  parseAllBreadcrumbs,
  createEmptyGateResults,
  validateDocumentGates,
  validateTestCaseGates,
  collectTestCaseArtifacts,
  loadTestCaseSources,
  validateTestCaseName,
  validateTestIndependence,
  validateTestDocumentation,
  validateTestDataManagement,
  detectCycles,
  validateHeadings,
  validateTableOfContents,
  validateNamingRules,
  validateScopeSections,
  collectHeadings,
  findSectionByHeading,
  collectLinksFromSection,
  sectionHasListWithContent,
  collectListItemTexts,
  buildMarkdownAst,
  extractDocumentTitle,
  normalizeFrontMatter,
  normalizeLinkArray,
  splitLinks,
  walkTestDirectory,
  outputResults,
  constants: {
    VALID_LAYERS,
    TEST_CASE_CATEGORIES,
    DEFAULT_CONTEXT_CANDIDATES,
    TEST_CASE_ROOT_CANDIDATES,
    DOC_GATE_IDS,
    TEST_GATE_IDS,
    ALL_GATE_IDS
  }
};

module.exports = exported;

if (require.main === module) {
  main().catch(error => {
    console.error('Unexpected error during validation:', error);
    process.exit(2);
  });
}
