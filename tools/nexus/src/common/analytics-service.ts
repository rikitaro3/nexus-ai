import fs from 'fs';
import path from 'path';

const VALID_LAYERS = new Set(['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA']);

export interface CollectAnalyticsOptions {
  projectRoot: string;
  persistHistory?: boolean;
  historyFilePath?: string;
}

export interface QualityGateViolation {
  gateId?: string;
  path: string;
  message: string;
  link?: string;
  layer?: string;
  cycle?: string[];
  line?: number;
  anchor?: string;
  section?: string;
}

export interface QualityGateHistoryEntry {
  timestamp: string;
  violationTotals: Record<string, number>;
  passRate: number;
}

export interface AnalyticsMetrics {
  generatedAt: string;
  context: {
    entries: number;
  };
  dag: {
    totalNodes: number;
    layers: Record<string, number>;
    missingBreadcrumbs: QualityGateViolation[];
    invalidLayers: QualityGateViolation[];
    brokenLinks: QualityGateViolation[];
    cycles: QualityGateViolation[];
    missingNodes: QualityGateViolation[];
    orphanCandidates: string[];
  };
  tasks: {
    total: number;
    statusCounts: Record<string, number>;
    priorityCounts: Record<string, number>;
    completionRate: number;
  };
  qualityGates: {
    gates: Record<GateId, {
      violationCount: number;
      violations: QualityGateViolation[];
    }>;
    passRate: number;
    failingDocuments: string[];
    history: QualityGateHistoryEntry[];
  };
}

interface ContextEntry {
  category: string;
  path: string;
  desc: string;
}

interface BreadcrumbNode {
  path: string;
  layer: string;
  upstream: string[];
  downstream: string[];
}

type GateId =
  | 'DOC-01'
  | 'DOC-02'
  | 'DOC-03'
  | 'DOC-04'
  | 'DOC-05'
  | 'DOC-06'
  | 'DOC-07'
  | 'DOC-08';

type GateMap = Record<GateId, QualityGateViolation[]>;

export async function collectAnalytics(options: CollectAnalyticsOptions): Promise<AnalyticsMetrics> {
  const projectRoot = path.resolve(options.projectRoot);
  const historyFilePath = options.historyFilePath
    ? resolveWithinProject(projectRoot, options.historyFilePath)
    : path.join(projectRoot, 'tools', 'nexus', 'analytics-history.json');

  const contextText = loadContext(projectRoot);
  const entries = parseContextEntries(contextText);
  const { nodes, missingBreadcrumbPaths, docContents } = buildNodes(projectRoot, entries);
  const orphanCandidates = detectOrphans(projectRoot, entries);
  const gateResults = computeGateResults(nodes, missingBreadcrumbPaths, docContents, entries);

  const tasks = readTasks(projectRoot);
  const taskMetrics = summarizeTasks(tasks);

  const generatedAt = new Date().toISOString();
  const gateSummary = summarizeGates(gateResults, nodes, missingBreadcrumbPaths.length);
  if (missingBreadcrumbPaths.length > 0) {
    gateSummary.layers['UNSPECIFIED'] = (gateSummary.layers['UNSPECIFIED'] || 0) + missingBreadcrumbPaths.length;
  }

  const history = loadHistory(historyFilePath);
  const violationTotals: Record<string, number> = {};
  for (const [gateId, violations] of Object.entries(gateResults) as Array<[GateId, QualityGateViolation[]]>) {
    violationTotals[gateId] = violations.length;
  }

  const newEntry: QualityGateHistoryEntry = {
    timestamp: generatedAt,
    violationTotals,
    passRate: gateSummary.passRate,
  };

  const nextHistory = appendHistory(history, newEntry);
  if (options.persistHistory && shouldPersist(history, nextHistory)) {
    saveHistory(historyFilePath, nextHistory);
  }

  return {
    generatedAt,
    context: { entries: entries.length },
    dag: {
      totalNodes: nodes.size + missingBreadcrumbPaths.length,
      layers: gateSummary.layers,
      missingBreadcrumbs: gateResults['DOC-01'],
      invalidLayers: gateResults['DOC-02'],
      brokenLinks: gateResults['DOC-03'],
      cycles: gateResults['DOC-04'],
      missingNodes: buildMissingNodes(gateResults),
      orphanCandidates,
    },
    tasks: taskMetrics,
    qualityGates: {
      gates: Object.fromEntries(
        (Object.entries(gateResults) as Array<[keyof GateMap, QualityGateViolation[]]>).map(([gateId, violations]) => [
          gateId,
          {
            violationCount: violations.length,
            violations,
          },
        ])
      ) as Record<GateId, { violationCount: number; violations: QualityGateViolation[] }>,
      passRate: gateSummary.passRate,
      failingDocuments: Array.from(gateSummary.failingDocuments),
      history: nextHistory,
    },
  };
}

function resolveWithinProject(projectRoot: string, relOrAbs: string): string {
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.resolve(projectRoot, relOrAbs);
}

function loadContext(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, '.cursor', 'context.mdc'),
    path.join(projectRoot, 'tools', 'nexus', 'context.mdc'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, 'utf8');
      } catch {
        // continue to next candidate
      }
    }
  }
  return '';
}

function extractSection(text: string, startHeader: string, stopHeaderPrefix = '## '): string {
  if (!text) return '';
  const startIdx = text.indexOf(startHeader);
  if (startIdx === -1) return '';
  const after = text.slice(startIdx);
  const rest = after.slice(startHeader.length);
  if (!stopHeaderPrefix) return after.trim();

  const escapedPrefix = stopHeaderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\n${escapedPrefix}`);
  const match = regex.exec(rest);
  if (!match) return after.trim();
  return after.slice(0, startHeader.length + match.index).trim();
}

function parseContextEntries(context: string): ContextEntry[] {
  const entries: ContextEntry[] = [];
  if (!context) return entries;
  const mapSection = extractSection(context, '## Context Map', '## ');
  if (!mapSection) return entries;

  const lines = mapSection.split('\n');
  let currentCat: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const catMatch = line.match(/^###\s+(.+)$/);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(/^\-\s+([^\s].*?)\s+…\s+(.*)$/);
    if (itemMatch && currentCat) {
      entries.push({ category: currentCat, path: itemMatch[1].trim(), desc: itemMatch[2].trim() });
    }
  }
  return entries;
}

function buildNodes(
  projectRoot: string,
  entries: ContextEntry[]
): { nodes: Map<string, BreadcrumbNode>; missingBreadcrumbPaths: string[]; docContents: Map<string, string> } {
  const nodes = new Map<string, BreadcrumbNode>();
  const missing: string[] = [];
  const docContents = new Map<string, string>();
  for (const entry of entries) {
    const docPath = resolveWithinProject(projectRoot, entry.path);
    if (!fs.existsSync(docPath)) {
      missing.push(entry.path);
      continue;
    }
    try {
      const content = fs.readFileSync(docPath, 'utf8');
      docContents.set(entry.path, content);
      const bc = extractBreadcrumbs(content);
      if (!bc) {
        missing.push(entry.path);
        continue;
      }
      const layer = ((bc.match(/>\s*Layer:\s*(.+)/) || [])[1] || '').trim();
      const upRaw = ((bc.match(/>\s*Upstream:\s*(.+)/) || [])[1] || '').trim();
      const downRaw = ((bc.match(/>\s*Downstream:\s*(.+)/) || [])[1] || '').trim();
      const upstream = splitLinks(upRaw);
      const downstream = splitLinks(downRaw);
      nodes.set(entry.path, { path: entry.path, layer, upstream, downstream });
    } catch {
      missing.push(entry.path);
    }
  }
  return { nodes, missingBreadcrumbPaths: Array.from(new Set(missing)), docContents };
}

function extractBreadcrumbs(text: string): string {
  if (!text) return '';
  const match = text.match(/>\s*Breadcrumbs[\s\S]*?(?=\n#|\n##|$)/);
  return match ? match[0] : '';
}

function splitLinks(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part && part.toUpperCase() !== 'N/A');
}

function detectOrphans(projectRoot: string, entries: ContextEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (!/(^|\/)docs\/.+\/index\.mdc$/.test(entry.path)) continue;
    const docPath = resolveWithinProject(projectRoot, entry.path);
    if (!fs.existsSync(docPath)) {
      result.push(entry.path);
      continue;
    }
    try {
      const content = fs.readFileSync(docPath, 'utf8');
      const bc = extractBreadcrumbs(content);
      if (!bc) {
        result.push(entry.path);
        continue;
      }
      const up = ((bc.match(/>\s*Upstream:\s*(.*)/) || [])[1] || '').trim();
      const down = ((bc.match(/>\s*Downstream:\s*(.*)/) || [])[1] || '').trim();
      const hasValue = (value: string) => value && value.trim() !== '' && value.trim().toUpperCase() !== 'N/A';
      if (!hasValue(up) && !hasValue(down)) {
        result.push(entry.path);
      }
    } catch {
      result.push(entry.path);
    }
  }
  return Array.from(new Set(result));
}

function computeGateResults(
  nodes: Map<string, BreadcrumbNode>,
  missingBreadcrumbPaths: string[],
  docContents: Map<string, string>,
  entries: ContextEntry[]
): GateMap {
  const results: GateMap = {
    'DOC-01': missingBreadcrumbPaths.map(path => ({ gateId: 'DOC-01', path, message: 'Breadcrumbsブロックが見つかりません' })),
    'DOC-02': [],
    'DOC-03': [],
    'DOC-04': [],
    'DOC-05': [],
    'DOC-06': [],
    'DOC-07': [],
    'DOC-08': [],
  };

  for (const [path, node] of nodes) {
    if (!node.layer && !node.upstream.length && !node.downstream.length && !results['DOC-01'].some(v => v.path === path)) {
      results['DOC-01'].push({ gateId: 'DOC-01', path, message: 'Breadcrumbsブロックが見つかりません' });
    }
    if (node.layer && !VALID_LAYERS.has(node.layer.toUpperCase())) {
      results['DOC-02'].push({ gateId: 'DOC-02', path, layer: node.layer, message: `無効なLayer: ${node.layer}` });
    }
    for (const up of node.upstream) {
      if (!nodes.has(up)) {
        results['DOC-03'].push({ gateId: 'DOC-03', path, link: up, message: `Upstreamパスが存在しません: ${up}` });
      }
    }
    for (const down of node.downstream) {
      if (!nodes.has(down)) {
        results['DOC-03'].push({ gateId: 'DOC-03', path, link: down, message: `Downstreamパスが存在しません: ${down}` });
      }
    }
  }

  results['DOC-04'] = detectCycles(nodes);
  results['DOC-05'] = evaluateHeadingNumbering(docContents);
  results['DOC-06'] = evaluateTableOfContents(docContents);
  results['DOC-07'] = evaluateFileNaming(entries, nodes);
  results['DOC-08'] = evaluateScopeBlocks(docContents);

  return results;
}

function detectCycles(nodes: Map<string, BreadcrumbNode>): QualityGateViolation[] {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: QualityGateViolation[] = [];

  function dfs(current: string, stack: string[]): void {
    if (recStack.has(current)) {
      const cycle = [...stack, current];
      cycles.push({ gateId: 'DOC-04', path: current, cycle, message: `循環参照: ${cycle.join(' → ')}` });
      return;
    }
    if (visited.has(current)) return;

    visited.add(current);
    recStack.add(current);
    stack.push(current);

    const node = nodes.get(current);
    if (node) {
      for (const next of node.downstream) {
        dfs(next, [...stack]);
      }
    }

    recStack.delete(current);
  }

  for (const [path] of nodes) {
    if (!visited.has(path)) {
      dfs(path, []);
    }
  }

  return cycles;
}

interface HeadingInfo {
  text: string;
  line: number;
  slug: string;
}

function evaluateHeadingNumbering(docContents: Map<string, string>): QualityGateViolation[] {
  const violations: QualityGateViolation[] = [];
  for (const [docPath, content] of docContents) {
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    let expected = 1;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/^#{1,6}\s+(\d+)\./);
      if (!match) continue;
      const number = parseInt(match[1], 10);
      if (Number.isNaN(number)) continue;
      if (number !== expected) {
        violations.push({
          gateId: 'DOC-05',
          path: docPath,
          line: i + 1,
          message: `章番号の順序が不正です (期待: ${expected}, 実際: ${number})`,
        });
        expected = number + 1;
      } else {
        expected += 1;
      }
    }
  }
  return dedupeViolations(violations);
}

function evaluateTableOfContents(docContents: Map<string, string>): QualityGateViolation[] {
  const violations: QualityGateViolation[] = [];
  for (const [docPath, content] of docContents) {
    if (!content) continue;
    const tocMatch = content.match(/##\s*目次[\s\S]*?(?=\n##\s|$)/);
    if (!tocMatch) {
      violations.push({ gateId: 'DOC-06', path: docPath, section: '目次', message: '## 目次 セクションが見つかりません' });
      continue;
    }
    const tocBlock = tocMatch[0];
    const linkMatches = Array.from(tocBlock.matchAll(/\[(?:.+?)\]\(#([^)]+)\)/g));
    if (linkMatches.length === 0) {
      violations.push({ gateId: 'DOC-06', path: docPath, section: '目次', message: '目次リンクが存在しません' });
      continue;
    }
    const headings = extractHeadings(content);
    const headingSlugs = new Set(headings.map(h => h.slug));
    for (const match of linkMatches) {
      const anchor = match[1];
      if (!headingSlugs.has(anchor) && !headingSlugs.has(anchor.toLowerCase())) {
        violations.push({
          gateId: 'DOC-06',
          path: docPath,
          message: `目次リンク先が見つかりません: #${anchor}`,
          anchor,
        });
      }
    }
  }
  return dedupeViolations(violations);
}

function evaluateFileNaming(entries: ContextEntry[], nodes: Map<string, BreadcrumbNode>): QualityGateViolation[] {
  const violations: QualityGateViolation[] = [];
  for (const entry of entries) {
    const filename = path.basename(entry.path);
    if (/^index\.(mdc|md)$/i.test(filename)) continue;
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.mdc' && ext !== '.md') {
      violations.push({ gateId: 'DOC-07', path: entry.path, message: `拡張子が不正です: ${filename}` });
      continue;
    }

    const asciiOnly = /^[\x00-\x7F]+$/.test(filename);
    if (ext === '.mdc' && asciiOnly) {
      const baseRule = /^[A-Z0-9][A-Za-z0-9_-]*\.mdc$/;
      if (!baseRule.test(filename)) {
        violations.push({ gateId: 'DOC-07', path: entry.path, message: `命名規則に違反しています: ${filename}` });
      }
    }

    const layer = (nodes.get(entry.path)?.layer || entry.category || '').toUpperCase();
    if (layer === 'PRD') {
      if (!/^PRD_[A-Za-z0-9_-]+\.mdc$/.test(filename)) {
        violations.push({ gateId: 'DOC-07', path: entry.path, message: 'PRD層ドキュメントは PRD_ で始まる .mdc が必要です' });
      }
    } else if (layer === 'ARCH') {
      if (!/^[\p{L}\p{N}_-]+\.(mdc|md)$/iu.test(filename)) {
        violations.push({ gateId: 'DOC-07', path: entry.path, message: 'ARCH層ドキュメントは拡張子 .md / .mdc のみ許可されています' });
      }
    } else if (layer === 'QA') {
      if (ext !== '.mdc') {
        violations.push({ gateId: 'DOC-07', path: entry.path, message: 'QA層ドキュメントは .mdc 拡張子である必要があります' });
      }
    }
  }
  return dedupeViolations(violations);
}

function evaluateScopeBlocks(docContents: Map<string, string>): QualityGateViolation[] {
  const sections = [
    { header: '## 扱う内容', key: '扱う内容' },
    { header: '## 扱わない内容', key: '扱わない内容' },
    { header: '## Scope', key: 'Scope' },
  ];

  const violations: QualityGateViolation[] = [];

  for (const [docPath, content] of docContents) {
    if (!content) continue;
    let foundSection = false;

    for (const section of sections) {
      const block = extractSection(content, section.header, '## ');
      if (!block) continue;
      foundSection = true;
      const normalized = block.replace(section.header, '').trim();
      if (!normalized) {
        violations.push({ gateId: 'DOC-08', path: docPath, section: section.key, message: `${section.key} セクションが空です` });
        continue;
      }
      if (!/^[\s]*[-*]\s+/m.test(normalized)) {
        violations.push({ gateId: 'DOC-08', path: docPath, section: section.key, message: `${section.key} は箇条書きで記載してください` });
      }
    }

    if (!foundSection) {
      violations.push({ gateId: 'DOC-08', path: docPath, message: 'Scope関連セクションが見つかりません' });
    }
  }

  return dedupeViolations(violations);
}

function extractHeadings(content: string): HeadingInfo[] {
  const lines = content.split(/\r?\n/);
  const headings: HeadingInfo[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    const text = match[2].trim();
    headings.push({ text, line: i + 1, slug: slugifyHeading(text) });
  }
  return headings;
}

function slugifyHeading(text: string): string {
  const sanitized = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]+/gu, '')
    .replace(/\s+/g, '-');
  return sanitized || text.trim().toLowerCase();
}

function dedupeViolations(violations: QualityGateViolation[]): QualityGateViolation[] {
  const seen = new Set<string>();
  const result: QualityGateViolation[] = [];
  for (const violation of violations) {
    const key = [violation.gateId, violation.path, violation.message, violation.line, violation.anchor, violation.section].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(violation);
  }
  return result;
}

interface TaskRecord {
  status?: string;
  priority?: string;
}

function readTasks(projectRoot: string): TaskRecord[] {
  const filePath = path.join(projectRoot, 'tools', 'nexus', 'tasks.json');
  if (!fs.existsSync(filePath)) return [];
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data as TaskRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

function summarizeTasks(tasks: TaskRecord[]): AnalyticsMetrics['tasks'] {
  const statusCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  let done = 0;
  for (const task of tasks) {
    const status = (task.status || 'UNKNOWN').toString();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status === 'DONE') done += 1;

    const priority = (task.priority || 'UNSPECIFIED').toString();
    priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
  }
  const total = tasks.length;
  const completionRate = total === 0 ? 0 : done / total;
  return {
    total,
    statusCounts,
    priorityCounts,
    completionRate,
  };
}

function summarizeGates(results: GateMap, nodes: Map<string, BreadcrumbNode>, missingCount: number): {
  layers: Record<string, number>;
  failingDocuments: Set<string>;
  passRate: number;
} {
  const failingDocuments = new Set<string>();

  for (const violations of Object.values(results)) {
    for (const violation of violations) {
      failingDocuments.add(violation.path);
    }
  }

  const layers: Record<string, number> = {};
  for (const node of nodes.values()) {
    const key = node.layer ? node.layer.toUpperCase() : 'UNSPECIFIED';
    layers[key] = (layers[key] || 0) + 1;
  }

  const totalCount = nodes.size + missingCount;
  const passRate = totalCount === 0 ? 1 : Math.max(0, (totalCount - failingDocuments.size) / totalCount);

  return { layers, failingDocuments, passRate };
}

function buildMissingNodes(results: GateMap): QualityGateViolation[] {
  const merged: QualityGateViolation[] = [];
  const seen = new Set<string>();
  for (const gateId of ['DOC-01', 'DOC-03'] as Array<keyof GateMap>) {
    for (const violation of results[gateId]) {
      const key = `${gateId}:${violation.path}:${violation.message}:${violation.link || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...violation, gateId, message: `[${gateId}] ${violation.message}` });
    }
  }
  return merged;
}

function loadHistory(filePath: string): QualityGateHistoryEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data
      .map((entry: any) => ({
        timestamp: typeof entry?.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
        violationTotals: typeof entry?.violationTotals === 'object' && entry?.violationTotals
          ? entry.violationTotals
          : {},
        passRate: typeof entry?.passRate === 'number' ? entry.passRate : 0,
      }))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveHistory(filePath: string, history: QualityGateHistoryEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch {
    // ignore write errors
  }
}

function appendHistory(history: QualityGateHistoryEntry[], entry: QualityGateHistoryEntry): QualityGateHistoryEntry[] {
  const next = [...history];
  const last = history[history.length - 1];
  if (!last || !isSameHistoryEntry(last, entry)) {
    next.push(entry);
  } else {
    next[next.length - 1] = entry;
  }
  const MAX_HISTORY = 50;
  return next.slice(Math.max(0, next.length - MAX_HISTORY));
}

function shouldPersist(before: QualityGateHistoryEntry[], after: QualityGateHistoryEntry[]): boolean {
  if (before.length !== after.length) return true;
  if (before.length === 0) return false;
  const lastBefore = before[before.length - 1];
  const lastAfter = after[after.length - 1];
  return !isSameHistoryEntry(lastBefore, lastAfter);
}

function isSameHistoryEntry(a: QualityGateHistoryEntry, b: QualityGateHistoryEntry): boolean {
  if (Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) > 1000 * 60) {
    // timestamps differ significantly, treat as different entry
    return false;
  }
  if (Math.abs(a.passRate - b.passRate) > 0.0001) return false;
  const keys = new Set([...Object.keys(a.violationTotals), ...Object.keys(b.violationTotals)]);
  for (const key of keys) {
    if ((a.violationTotals[key] || 0) !== (b.violationTotals[key] || 0)) return false;
  }
  return true;
}
