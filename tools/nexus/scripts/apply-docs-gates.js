#!/usr/bin/env node

/**
 * Nexus Quality Gate Autofix (Documents)
 *
 * This script applies automatic fixes for the document-oriented Quality Gates
 * defined in `tools/nexus/docs/GATES/document.mdc`. It reads the target
 * documents from `context.mdc`, applies best-effort fixes (breadcrumbs,
 * numbering, table of contents, scope sections, naming rules, etc.), and
 * produces a summary of the performed operations. The script can optionally
 * perform a dry-run to preview the fixes.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const {
  parseContextEntries,
  extractBreadcrumbs,
  extractField,
  splitLinks,
  extractHeadings,
  extractSectionByTitle,
  detectCycles,
  constants
} = require('./validate-docs-gates.js');

const VALID_LAYERS = constants.VALID_LAYERS;

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  try {
    const summary = await applyDocsGatesAutofix({
      projectRoot: args.projectRoot || process.cwd(),
      contextPath: args.contextPath,
      dryRun: args.dryRun
    });

    if (args.format === 'json') {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printHumanReadableSummary(summary);
    }

    if (summary.errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('[apply-docs-gates] Unexpected error:', error);
    process.exit(2);
  }
}

function parseArgs(argv = []) {
  const parsed = {
    projectRoot: null,
    contextPath: null,
    dryRun: false,
    format: 'json'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root' || arg === '-r') {
      parsed.projectRoot = argv[++i];
    } else if (arg.startsWith('--project-root=')) {
      parsed.projectRoot = arg.split('=')[1];
    } else if (arg === '--context' || arg === '-c') {
      parsed.contextPath = argv[++i];
    } else if (arg.startsWith('--context=')) {
      parsed.contextPath = arg.split('=')[1];
    } else if (arg === '--dry-run' || arg === '--check') {
      parsed.dryRun = true;
    } else if (arg === '--json') {
      parsed.format = 'json';
    } else if (arg === '--table' || arg === '--human') {
      parsed.format = 'table';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/apply-docs-gates.js [options]\n\n` +
    `Options:\n` +
    `  -r, --project-root <path>   Project root (default: cwd)\n` +
    `  -c, --context <path>        Explicit context.mdc path\n` +
    `      --dry-run               Preview changes without writing\n` +
    `      --json                  Output JSON summary (default)\n` +
    `      --table                 Output human readable summary\n` +
    `  -h, --help                  Show this help message\n`);
}

async function applyDocsGatesAutofix(options) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const { contextPath, contextText } = await resolveContext(projectRoot, options.contextPath);

  if (!contextPath) {
    throw new Error('Context map (context.mdc) could not be found.');
  }

  const timestamp = new Date().toISOString();
  const entries = parseContextEntries(contextText);
  const docTargets = await loadDocuments(projectRoot, entries);

  const renamePlan = buildRenamePlan(docTargets.records);
  const renameMap = new Map(renamePlan.map(item => [item.from, item.to]));

  for (const record of docTargets.records) {
    record.finalPath = renameMap.get(record.relativePath) || record.relativePath;
  }

  const existingPaths = new Set(
    docTargets.records.map(record => record.finalPath.replace(/\\/g, '/'))
  );

  const pathExistsCache = new Map();
  const pathExistenceChecker = target => ensurePathExists(projectRoot, target, pathExistsCache);

  const operations = [];
  const warnings = [];
  const errors = [];

  for (const record of docTargets.records) {
    try {
      await applyGateFixes(record, {
        renameMap,
        pathExists: pathExistenceChecker,
        existingPaths,
        allRecords: docTargets.records
      });
      if (record.changed) {
        const finalPath = renameMap.get(record.relativePath) || record.relativePath;
        operations.push({
          type: 'modify',
          path: finalPath,
          actions: Array.from(record.actions)
        });
      }
    } catch (error) {
      errors.push(`Failed to fix ${record.relativePath}: ${(error && error.message) || error}`);
    }
  }

  if (renamePlan.length > 0) {
    for (const plan of renamePlan) {
      operations.push({
        type: 'rename',
        from: plan.from,
        to: plan.to,
        reason: plan.reason
      });
    }
  }

  try {
    breakCycles(docTargets.records, renameMap);
  } catch (error) {
    warnings.push(`Cycle resolution failed: ${(error && error.message) || error}`);
  }

  // After cycle fixes we may have updated breadcrumbs again
  for (const record of docTargets.records) {
    if (record.pendingLinkNormalization) {
      try {
        await normalizeBreadcrumbLinks(record, {
          renameMap,
          pathExists: pathExistenceChecker,
          existingPaths
        });
      } catch (error) {
        warnings.push(`Failed to normalize breadcrumbs for ${record.relativePath}: ${(error && error.message) || error}`);
      }
    }
  }

  const contextUpdates = applyContextRenames(contextText, renamePlan);
  if (contextUpdates.changed) {
    operations.push({
      type: 'modify',
      path: path.relative(projectRoot, contextPath) || contextPath,
      actions: contextUpdates.actions
    });
  }

  if (!options.dryRun) {
    await persistChanges({
      projectRoot,
      records: docTargets.records,
      renamePlan,
      contextPath,
      contextContent: contextUpdates.content
    });
  }

  const summary = {
    status: errors.length ? 'failed' : 'ok',
    timestamp,
    projectRoot,
    contextPath: path.relative(projectRoot, contextPath) || contextPath,
    dryRun: !!options.dryRun,
    operations,
    renameMap: renamePlan,
    warnings,
    errors
  };

  return summary;
}

async function resolveContext(projectRoot, overridePath) {
  if (overridePath) {
    const candidate = path.isAbsolute(overridePath)
      ? overridePath
      : path.join(projectRoot, overridePath);
    try {
      const contextText = await fs.readFile(candidate, 'utf8');
      return { contextPath: candidate, contextText };
    } catch (error) {
      throw new Error(`Failed to read context file: ${(error && error.message) || error}`);
    }
  }

  const defaultCandidates = Array.isArray(constants?.DEFAULT_CONTEXT_CANDIDATES)
    ? constants.DEFAULT_CONTEXT_CANDIDATES
    : ['.cursor/context.mdc', 'context.mdc', path.join('tools', 'nexus', 'context.mdc')];
  const candidates = defaultCandidates.length ? defaultCandidates : ['context.mdc'];

  for (const candidate of candidates) {
    const target = path.join(projectRoot, candidate);
    try {
      const contextText = await fs.readFile(target, 'utf8');
      return { contextPath: target, contextText };
    } catch (_) {
      // continue
    }
  }

  return { contextPath: null, contextText: '' };
}

async function loadDocuments(projectRoot, entries) {
  const records = [];
  const missing = [];

  for (const entry of entries) {
    const relPath = entry.path;
    const absPath = path.join(projectRoot, relPath);
    try {
      const content = await fs.readFile(absPath, 'utf8');
      records.push(createDocRecord(relPath, absPath, content));
    } catch (error) {
      missing.push({ path: relPath, error: (error && error.message) || error });
    }
  }

  return { records, missing };
}

function createDocRecord(relativePath, absolutePath, content) {
  return {
    relativePath,
    absolutePath,
    finalPath: relativePath,
    content,
    originalContent: content,
    actions: new Set(),
    changed: false,
    pendingLinkNormalization: false
  };
}

function buildRenamePlan(records) {
  const plan = [];
  const usedTargets = new Set(records.map(r => r.relativePath));

  for (const record of records) {
    const proposed = proposeFileName(record.relativePath, record.content);
    if (!proposed || proposed === record.relativePath) continue;
    let candidate = proposed;
    let attempt = 1;
    while (usedTargets.has(candidate)) {
      const ext = path.extname(candidate);
      const base = path.basename(candidate, ext);
      candidate = `${base}_${attempt}${ext}`;
      attempt += 1;
    }
    usedTargets.add(candidate);
    plan.push({ from: record.relativePath, to: candidate, reason: 'DOC-07 naming rules' });
  }

  return plan;
}

async function applyGateFixes(record, context) {
  ensureBreadcrumbs(record, context);
  normalizeLayer(record, context);
  await normalizeBreadcrumbLinks(record, context);
  ensureScopeSections(record);
  enforceHeadingNumbering(record);
  ensureTableOfContents(record);
}

function ensureBreadcrumbs(record, context) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  const layer = determineLayer(record.finalPath, breadcrumbs);
  const upstream = extractField(breadcrumbs, 'Upstream');
  const downstream = extractField(breadcrumbs, 'Downstream');

  const blockLines = [
    '> Breadcrumbs',
    `> Layer: ${layer}`,
    `> Upstream: ${upstream || 'N/A'}`,
    `> Downstream: ${downstream || 'N/A'}`
  ];
  const canonicalBlock = blockLines.join('\n');

  if (!breadcrumbs) {
    insertBreadcrumbsBlock(record, canonicalBlock);
    record.actions.add('DOC-01: Breadcrumbs block inserted');
    record.pendingLinkNormalization = true;
    return;
  }

  if (!breadcrumbs.includes('> Layer:') || !breadcrumbs.includes('> Upstream:') || !breadcrumbs.includes('> Downstream:')) {
    replaceBreadcrumbsBlock(record, breadcrumbs, canonicalBlock);
    record.actions.add('DOC-01: Breadcrumbs block normalized');
    record.pendingLinkNormalization = true;
    return;
  }
}

function insertBreadcrumbsBlock(record, blockText) {
  const lines = record.content.split('\n');
  let insertIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+/.test(lines[i])) {
      insertIndex = i + 1;
      break;
    }
  }

  const parts = [];
  parts.push(...lines.slice(0, insertIndex));
  if (parts.length === 0 || parts[parts.length - 1].trim() !== '') {
    parts.push('');
  }
  parts.push(blockText);
  parts.push('');
  parts.push(...lines.slice(insertIndex));
  const nextContent = normalizeTrailingNewline(parts.join('\n'));
  updateRecordContent(record, nextContent);
}

function replaceBreadcrumbsBlock(record, previous, nextBlock) {
  const nextContent = normalizeTrailingNewline(record.content.replace(previous, nextBlock));
  if (nextContent !== record.content) {
    updateRecordContent(record, nextContent);
  }
}

function normalizeLayer(record) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  if (!breadcrumbs) return;
  const current = extractField(breadcrumbs, 'Layer');
  const inferred = determineLayer(record.finalPath, breadcrumbs);
  if (!current || current.toUpperCase() !== inferred) {
    const updated = breadcrumbs.replace(/>\s*Layer:\s*.*$/m, `> Layer: ${inferred}`);
    replaceBreadcrumbsBlock(record, breadcrumbs, updated);
    record.actions.add('DOC-02: Layer normalized');
    record.pendingLinkNormalization = true;
  }
}

async function normalizeBreadcrumbLinks(record, context) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  if (!breadcrumbs) return;

  const upstreamLine = extractField(breadcrumbs, 'Upstream');
  const downstreamLine = extractField(breadcrumbs, 'Downstream');

  const normalize = raw => normalizeLinkList({
    raw,
    renameMap: context.renameMap,
    existingPaths: context.existingPaths,
    pathExists: context.pathExists
  });

  const upstreamNormalized = await normalize(upstreamLine);
  const downstreamNormalized = await normalize(downstreamLine);

  let updatedBlock = breadcrumbs;
  if (upstreamNormalized.changed) {
    updatedBlock = updatedBlock.replace(/>\s*Upstream:\s*.*$/m, `> Upstream: ${upstreamNormalized.value}`);
  }
  if (downstreamNormalized.changed) {
    updatedBlock = updatedBlock.replace(/>\s*Downstream:\s*.*$/m, `> Downstream: ${downstreamNormalized.value}`);
  }

  if (updatedBlock !== breadcrumbs) {
    replaceBreadcrumbsBlock(record, breadcrumbs, updatedBlock);
    record.actions.add('DOC-03: Breadcrumb links normalized');
  }

  record.pendingLinkNormalization = false;
}

async function normalizeLinkList({ raw, renameMap, existingPaths, pathExists }) {
  const normalizedRaw = raw || '';
  const values = splitLinks(normalizedRaw);
  const nextValues = [];

  for (const value of values) {
    const normalizedInput = value.replace(/\\/g, '/');
    const mapped = renameMap.get(value) || renameMap.get(normalizedInput) || normalizedInput;
    const normalized = mapped.replace(/\\/g, '/');
    if (existingPaths.has(normalized)) {
      nextValues.push(normalized);
      continue;
    }
    nextValues.push(normalized);
  }

  const filtered = [];
  const seen = new Set();

  for (const value of nextValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    let exists = existingPaths.has(value);
    if (!exists && pathExists) {
      // eslint-disable-next-line no-await-in-loop
      exists = await pathExists(value);
    }
    if (exists) {
      filtered.push(value);
    }
  }

  if (filtered.length === 0) {
    return { changed: normalizedRaw.trim().toUpperCase() !== 'N/A', value: 'N/A' };
  }

  const joined = filtered.join(', ');
  return { changed: joined !== normalizedRaw.trim(), value: joined };
}

function enforceHeadingNumbering(record) {
  const lines = record.content.split('\n');
  const counters = [];
  let inCodeBlock = false;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = trimmed.match(/^(#{2,6})\s+(.*)$/);
    if (!match) continue;

    const level = match[1].length;
    const depth = level - 2;
    const text = match[2].trim();
    if (/^目次$/i.test(text)) continue;

    const bareText = text.replace(/^(\d+(?:\.\d+)*)\.\s+/, '').trim();
    if (depth === 0) {
      counters[0] = (counters[0] || 0) + 1;
      counters.length = 1;
    } else {
      for (let j = 0; j < depth; j += 1) {
        if (typeof counters[j] !== 'number' || Number.isNaN(counters[j])) {
          counters[j] = 1;
        }
      }
      counters[depth] = (counters[depth] || 0) + 1;
      counters.length = depth + 1;
    }

    const numbering = counters.slice(0, depth + 1).join('.');
    const replacement = `${match[1]} ${numbering}. ${bareText}`.trim();
    if (replacement !== trimmed) {
      lines[i] = replacement;
      changed = true;
    }
  }

  if (changed) {
    const nextContent = normalizeTrailingNewline(lines.join('\n'));
    updateRecordContent(record, nextContent);
    record.actions.add('DOC-05: Headings renumbered');
  }
}

function ensureTableOfContents(record) {
  const headings = extractHeadings(record.content);
  const filtered = headings.filter(heading => heading.level >= 2 && heading.level <= 6 && !/^目次$/i.test(heading.text.trim()));
  if (filtered.length === 0) return;

  const tocLines = ['## 目次', ''];
  for (const heading of filtered) {
    const slug = slugify(heading.text);
    const indent = '  '.repeat(Math.max(0, heading.level - 2));
    tocLines.push(`${indent}- [${heading.text.trim()}](#${slug})`);
  }

  tocLines.push('');
  const tocBlock = tocLines.join('\n');

  const existing = extractSectionByTitle(record.content, [/^目次$/i]);
  if (existing) {
    const pattern = new RegExp(`^##\s+目次[\s\S]*?(?=^##\s+|\u0000|\n\Z)`, 'm');
    const nextContent = normalizeTrailingNewline(record.content.replace(pattern, tocBlock));
    if (nextContent !== record.content) {
      updateRecordContent(record, nextContent);
      record.actions.add('DOC-06: Table of contents updated');
    }
  } else {
    insertSectionAfterBreadcrumbs(record, tocBlock);
    record.actions.add('DOC-06: Table of contents inserted');
  }
}

function ensureScopeSections(record) {
  const includeSection = extractSectionByTitle(record.content, [/^(扱う内容|in\s*scope)$/i]);
  const excludeSection = extractSectionByTitle(record.content, [/^(扱わない内容|out\s*of\s*scope|非スコープ)$/i]);

  const needsInclude = !hasListContent(includeSection);
  const needsExclude = !hasListContent(excludeSection);
  if (!needsInclude && !needsExclude) return;

  const additions = [];
  if (needsInclude) {
    additions.push('## 扱う内容', '- TBD: スコープ内の要素を記載してください', '');
  }
  if (needsExclude) {
    additions.push('## 扱わない内容', '- TBD: スコープ外の要素を記載してください', '');
  }

  insertSectionAfterBreadcrumbs(record, additions.join('\n'));
  record.actions.add('DOC-08: Scope sections scaffolded');
}

function insertSectionAfterBreadcrumbs(record, sectionText) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  if (!breadcrumbs) return;
  const index = record.content.indexOf(breadcrumbs);
  if (index === -1) return;

  const afterIndex = index + breadcrumbs.length;
  const before = record.content.slice(0, afterIndex).replace(/\n*$/g, '\n\n');
  const after = record.content.slice(afterIndex).replace(/^\n*/, '\n');
  const nextContent = normalizeTrailingNewline(`${before}${sectionText}\n${after}`);
  updateRecordContent(record, nextContent);
}

function hasListContent(section) {
  if (!section || !section.content) return false;
  return section.content.split('\n').some(line => /^[-*]\s+.+/.test(line.trim()));
}

function breakCycles(records, renameMap) {
  const nodes = buildGraph(records, renameMap);
  const cycles = detectCycles(nodes);
  if (!cycles || cycles.length === 0) return;

  for (const cycle of cycles) {
    const cycleNodes = Array.isArray(cycle.cycle) ? cycle.cycle : [];
    if (cycleNodes.length < 2) continue;
    const last = cycleNodes[cycleNodes.length - 1];
    const prev = cycleNodes[cycleNodes.length - 2];
    if (!last || !prev) continue;

    const prevRecord = records.find(r => normalizePath(r.finalPath) === normalizePath(prev));
    if (!prevRecord) continue;
    removeDownstreamReference(prevRecord, last);

    const lastRecord = records.find(r => normalizePath(r.finalPath) === normalizePath(last));
    if (lastRecord) {
      removeUpstreamReference(lastRecord, prev);
    }

    prevRecord.actions.add('DOC-04: Downstream link trimmed to break cycle');
    prevRecord.pendingLinkNormalization = true;
    if (lastRecord) {
      lastRecord.actions.add('DOC-04: Upstream link trimmed to break cycle');
      lastRecord.pendingLinkNormalization = true;
    }
  }
}

function buildGraph(records, renameMap) {
  const nodes = new Map();
  for (const record of records) {
    const breadcrumbs = extractBreadcrumbs(record.content);
    if (!breadcrumbs) continue;
    const upstream = splitLinks(extractField(breadcrumbs, 'Upstream'))
      .map(value => renameMap.get(value) || value);
    const downstream = splitLinks(extractField(breadcrumbs, 'Downstream'))
      .map(value => renameMap.get(value) || value);

    nodes.set(normalizePath(record.finalPath), {
      path: record.finalPath,
      upstream: upstream.map(normalizePath),
      downstream: downstream.map(normalizePath)
    });
  }
  return nodes;
}

function removeDownstreamReference(record, targetPath) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  if (!breadcrumbs) return;
  const downstreamRaw = extractField(breadcrumbs, 'Downstream');
  const values = splitLinks(downstreamRaw);
  const nextValues = values.filter(value => normalizePath(value) !== normalizePath(targetPath));
  const nextLine = nextValues.length === 0 ? 'N/A' : nextValues.join(', ');
  const updated = breadcrumbs.replace(/>\s*Downstream:\s*.*$/m, `> Downstream: ${nextLine}`);
  replaceBreadcrumbsBlock(record, breadcrumbs, updated);
}

function removeUpstreamReference(record, targetPath) {
  const breadcrumbs = extractBreadcrumbs(record.content);
  if (!breadcrumbs) return;
  const upstreamRaw = extractField(breadcrumbs, 'Upstream');
  const values = splitLinks(upstreamRaw);
  const nextValues = values.filter(value => normalizePath(value) !== normalizePath(targetPath));
  const nextLine = nextValues.length === 0 ? 'N/A' : nextValues.join(', ');
  const updated = breadcrumbs.replace(/>\s*Upstream:\s*.*$/m, `> Upstream: ${nextLine}`);
  replaceBreadcrumbsBlock(record, breadcrumbs, updated);
}

function applyContextRenames(contextText, renamePlan) {
  if (!contextText) return { changed: false, content: contextText, actions: [] };
  if (!renamePlan || renamePlan.length === 0) {
    return { changed: false, content: contextText, actions: [] };
  }

  let nextContent = contextText;
  const actions = [];
  for (const { from, to } of renamePlan) {
    const pattern = new RegExp(escapeRegExp(from), 'g');
    if (pattern.test(nextContent)) {
      nextContent = nextContent.replace(pattern, to);
      actions.push(`DOC-07: Updated reference ${from} → ${to}`);
    }
  }

  return { changed: nextContent !== contextText, content: nextContent, actions };
}

async function persistChanges({ projectRoot, records, renamePlan, contextPath, contextContent }) {
  const renameMap = new Map(renamePlan.map(item => [item.from, item.to]));

  for (const item of renamePlan) {
    const from = path.join(projectRoot, item.from);
    const to = path.join(projectRoot, item.to);
    if (from === to) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  for (const record of records) {
    const targetPath = renameMap.get(record.relativePath) || record.finalPath;
    const absolutePath = path.join(projectRoot, targetPath);
    if (record.changed) {
      await fs.writeFile(absolutePath, record.content, 'utf8');
    }
  }

  if (contextContent && contextPath) {
    await fs.writeFile(contextPath, contextContent, 'utf8');
  }
}

async function ensurePathExists(projectRoot, relPath, cache) {
  if (relPath === 'N/A') return true;
  if (cache.has(relPath)) return cache.get(relPath);
  const target = path.join(projectRoot, relPath);
  const promise = fs.access(target).then(() => true).catch(() => false);
  cache.set(relPath, promise);
  return promise;
}

function updateRecordContent(record, nextContent) {
  if (nextContent !== record.content) {
    record.content = nextContent;
    record.changed = true;
  }
}

function determineLayer(relPath, breadcrumbs) {
  const current = extractField(breadcrumbs || '', 'Layer');
  if (VALID_LAYERS.includes((current || '').toUpperCase())) {
    return current.toUpperCase();
  }

  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const docsIndex = segments.indexOf('docs');
  if (docsIndex !== -1 && segments.length > docsIndex + 1) {
    const layerCandidate = segments[docsIndex + 1].toUpperCase();
    if (VALID_LAYERS.includes(layerCandidate)) {
      return layerCandidate;
    }
  }

  return 'QA';
}

function normalizeTrailingNewline(text) {
  return text.replace(/\s*$/, '\n');
}

function proposeFileName(relPath, content) {
  const baseName = path.basename(relPath);
  const baseLower = baseName.toLowerCase();
  if (baseLower === 'index.mdc' || baseLower === 'index.md') {
    return null;
  }
  if (isValidFileName(baseName, relPath)) return null;

  const ext = path.extname(baseName) || '.mdc';
  const layer = determineLayer(relPath, extractBreadcrumbs(content));
  const heading = extractPrimaryHeading(content);
  const slug = createAsciiSlug(heading || baseName.replace(ext, ''));
  const core = slug || createHashSlug(baseName);

  let result;
  if (layer === 'PRD') {
    result = `docs/PRD/PRD_${core.toUpperCase()}${ext}`;
  } else {
    const segments = relPath.replace(/\\/g, '/').split('/');
    if (segments.length >= 3) {
      segments[segments.length - 1] = `${core.toUpperCase()}${ext}`;
      result = segments.join('/');
    } else {
      result = `${core.toUpperCase()}${ext}`;
    }
  }

  return result;
}

function isValidFileName(baseName, relPath) {
  const normalized = baseName.toLowerCase();
  if (!normalized.endsWith('.mdc') && !normalized.endsWith('.md')) return false;

  const breadcrumbsLayer = determineLayer(relPath, '');
  return selectNamingPattern(breadcrumbsLayer).test(baseName);
}

function selectNamingPattern(layer) {
  switch (layer) {
    case 'PRD':
      return /^PRD_[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
    case 'ARCH':
      return /^[A-Z0-9][A-Za-z0-9_-]*\.(mdc|md)$/;
    case 'QA':
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

function extractPrimaryHeading(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return '';
}

function createAsciiSlug(text) {
  if (!text) return '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function createHashSlug(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 10).toUpperCase();
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s\-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printHumanReadableSummary(summary) {
  console.log('Docs Quality Gates Autofix');
  console.log(`Project Root: ${summary.projectRoot}`);
  console.log(`Context: ${summary.contextPath}`);
  console.log(`Dry Run: ${summary.dryRun ? 'yes' : 'no'}`);
  console.log(`Status: ${summary.status}`);
  if (summary.operations.length === 0) {
    console.log('No changes were required.');
  } else {
    console.log('Operations:');
    for (const op of summary.operations) {
      if (op.type === 'modify') {
        console.log(`  - modify ${op.path}`);
        if (Array.isArray(op.actions)) {
          for (const action of op.actions) {
            console.log(`      • ${action}`);
          }
        }
      } else if (op.type === 'rename') {
        console.log(`  - rename ${op.from} → ${op.to} (${op.reason})`);
      }
    }
  }

  if (summary.warnings.length) {
    console.log('Warnings:');
    for (const warning of summary.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (summary.errors.length) {
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`  - ${error}`);
    }
  }
}

module.exports = {
  main,
  parseArgs,
  applyDocsGatesAutofix,
  buildRenamePlan,
  ensureBreadcrumbs,
  normalizeLayer,
  normalizeBreadcrumbLinks,
  enforceHeadingNumbering,
  ensureTableOfContents,
  ensureScopeSections,
  breakCycles
};

if (require.main === module) {
  main().catch(error => {
    console.error('Failed to apply docs gates:', error);
    process.exit(2);
  });
}

