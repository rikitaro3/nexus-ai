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
    gates: Record<string, {
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

type GateMap = Record<'DOC-01' | 'DOC-02' | 'DOC-03' | 'DOC-04', QualityGateViolation[]>;

export async function collectAnalytics(options: CollectAnalyticsOptions): Promise<AnalyticsMetrics> {
  const projectRoot = path.resolve(options.projectRoot);
  const historyFilePath = options.historyFilePath
    ? resolveWithinProject(projectRoot, options.historyFilePath)
    : path.join(projectRoot, 'tools', 'nexus', 'analytics-history.json');

  const contextText = loadContext(projectRoot);
  const entries = parseContextEntries(contextText);
  const { nodes, missingBreadcrumbPaths } = buildNodes(projectRoot, entries);
  const orphanCandidates = detectOrphans(projectRoot, entries);
  const gateResults = computeGateResults(nodes, missingBreadcrumbPaths);

  const tasks = readTasks(projectRoot);
  const taskMetrics = summarizeTasks(tasks);

  const generatedAt = new Date().toISOString();
  const gateSummary = summarizeGates(gateResults, nodes, missingBreadcrumbPaths.length);
  if (missingBreadcrumbPaths.length > 0) {
    gateSummary.layers['UNSPECIFIED'] = (gateSummary.layers['UNSPECIFIED'] || 0) + missingBreadcrumbPaths.length;
  }

  const history = loadHistory(historyFilePath);
  const violationTotals: Record<string, number> = {
    'DOC-01': gateResults['DOC-01'].length,
    'DOC-02': gateResults['DOC-02'].length,
    'DOC-03': gateResults['DOC-03'].length,
    'DOC-04': gateResults['DOC-04'].length,
  };

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
      ),
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

function buildNodes(projectRoot: string, entries: ContextEntry[]): { nodes: Map<string, BreadcrumbNode>; missingBreadcrumbPaths: string[] } {
  const nodes = new Map<string, BreadcrumbNode>();
  const missing: string[] = [];
  for (const entry of entries) {
    const docPath = resolveWithinProject(projectRoot, entry.path);
    if (!fs.existsSync(docPath)) {
      missing.push(entry.path);
      continue;
    }
    try {
      const content = fs.readFileSync(docPath, 'utf8');
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
  return { nodes, missingBreadcrumbPaths: Array.from(new Set(missing)) };
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

function computeGateResults(nodes: Map<string, BreadcrumbNode>, missingBreadcrumbPaths: string[]): GateMap {
  const results: GateMap = {
    'DOC-01': missingBreadcrumbPaths.map(path => ({ gateId: 'DOC-01', path, message: 'Breadcrumbsブロックが見つかりません' })),
    'DOC-02': [],
    'DOC-03': [],
    'DOC-04': [],
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
