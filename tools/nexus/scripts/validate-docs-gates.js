#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const VALID_LAYERS = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
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

  const { nodes, docStatus } = await parseAllBreadcrumbs(entries, projectRoot);
  const results = validateGates(nodes, docStatus);

  outputResults({
    results,
    contextPath: path.relative(projectRoot, contextPath) || contextPath,
    projectRoot,
    docStatus
  }, args.format);

  const hasErrors = results['DOC-01'].some(v => v.severity !== 'warn') ||
    results['DOC-02'].some(v => v.severity !== 'warn') ||
    results['DOC-03'].some(v => v.severity !== 'warn');

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

  return { nodes, docStatus };
}

function validateGates(nodes, docStatus) {
  const results = {
    'DOC-01': [],
    'DOC-02': [],
    'DOC-03': [],
    'DOC-04': []
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

function outputResults(payload, format) {
  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('Docs Quality Gates Validation');
  console.log('Project Root:', payload.projectRoot);
  console.log('Context File:', payload.contextPath);
  console.log('');

  const order = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04'];
  for (const gateId of order) {
    const violations = payload.results[gateId];
    const status = violations.length === 0 ? 'PASS' : (gateId === 'DOC-04' ? 'WARN' : 'FAIL');
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
