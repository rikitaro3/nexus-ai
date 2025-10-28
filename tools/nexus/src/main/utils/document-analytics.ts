import type { QualityGateResults, QualityGateViolation } from './quality-gates.js';

export interface DocumentAnalyticsGateSummary {
  gateId: string;
  totalViolations: number;
  uniqueDocuments: number;
  severity: {
    error: number;
    warn: number;
    info: number;
  };
  impactedTasks: number;
}

export interface DocumentAnalyticsSnapshot {
  generatedAt: string;
  documents: {
    total: number;
    byStatus: Record<string, number>;
    withViolations: number;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
  gates: DocumentAnalyticsGateSummary[];
}

interface CollectDocumentAnalyticsInput {
  results?: QualityGateResults | null | undefined;
  docStatus?: unknown;
  tasks?: unknown;
}

type DocStatusEntry = {
  path: string;
  status: string;
};

const DOCUMENT_GATE_IDS = [
  'DOC-01',
  'DOC-02',
  'DOC-03',
  'DOC-04',
  'DOC-05',
  'DOC-06',
  'DOC-07',
  'DOC-08'
] as const;

const TEST_CASE_GATE_IDS = ['TC-01', 'TC-02', 'TC-03', 'TC-04'] as const;

const GATE_IDS = [...DOCUMENT_GATE_IDS, ...TEST_CASE_GATE_IDS] as const;

function normalizeDocStatus(input: unknown, fallbackPaths: Set<string>): DocStatusEntry[] {
  if (!input) {
    return Array.from(fallbackPaths).map(path => ({ path, status: 'unknown' }));
  }

  if (input instanceof Map) {
    const entries: DocStatusEntry[] = [];
    input.forEach((value, key) => {
      if (typeof key !== 'string') return;
      entries.push({ path: key, status: extractStatus(value) });
    });
    if (entries.length === 0 && fallbackPaths.size) {
      return Array.from(fallbackPaths).map(path => ({ path, status: 'unknown' }));
    }
    return entries;
  }

  if (typeof input === 'object') {
    const entries: DocStatusEntry[] = [];
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (typeof key !== 'string') continue;
      entries.push({ path: key, status: extractStatus(value) });
    }
    if (entries.length === 0 && fallbackPaths.size) {
      return Array.from(fallbackPaths).map(path => ({ path, status: 'unknown' }));
    }
    return entries;
  }

  return Array.from(fallbackPaths).map(path => ({ path, status: 'unknown' }));
}

function extractStatus(value: unknown): string {
  if (value && typeof value === 'object' && 'status' in value) {
    const status = (value as { status?: unknown }).status;
    if (typeof status === 'string' && status.trim()) {
      return status.trim();
    }
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'unknown';
}

function extractSeverity(violation: QualityGateViolation | undefined): 'error' | 'warn' | 'info' {
  const raw = violation?.severity;
  if (typeof raw === 'string') {
    const normalized = raw.toLowerCase();
    if (normalized === 'error' || normalized === 'warn' || normalized === 'info') {
      return normalized;
    }
  }
  return 'info';
}

function collectViolationDocuments(violations: QualityGateViolation[] | undefined): Set<string> {
  const docs = new Set<string>();
  if (!Array.isArray(violations)) return docs;
  for (const item of violations) {
    if (item && typeof item.path === 'string' && item.path.trim()) {
      docs.add(item.path.trim());
    }
  }
  return docs;
}

function extractTaskDocRefs(task: unknown): Set<string> {
  const refs = new Set<string>();
  if (!task || typeof task !== 'object') return refs;

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      refs.add(value.trim());
    }
  };

  const maybeLinks = (task as Record<string, unknown>).links;
  if (maybeLinks && typeof maybeLinks === 'object') {
    if (Array.isArray(maybeLinks)) {
      for (const item of maybeLinks) push(item);
    } else {
      for (const value of Object.values(maybeLinks as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          for (const inner of value) push(inner);
        } else {
          push(value);
        }
      }
    }
  }

  const relatedDocs = (task as Record<string, unknown>).documents ?? (task as Record<string, unknown>).docPaths;
  if (Array.isArray(relatedDocs)) {
    for (const item of relatedDocs) push(item);
  } else {
    push(relatedDocs);
  }

  return refs;
}

function summarizeTasks(tasks: unknown[]): { total: number; byStatus: Record<string, number>; references: Map<number, Set<string>> } {
  const byStatus: Record<string, number> = {};
  const references = new Map<number, Set<string>>();

  tasks.forEach((task, index) => {
    const statusRaw = (task as { status?: unknown })?.status;
    const status = typeof statusRaw === 'string' && statusRaw.trim()
      ? statusRaw.trim()
      : 'UNKNOWN';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    references.set(index, extractTaskDocRefs(task));
  });

  return { total: tasks.length, byStatus, references };
}

function buildGateSummary(
  results: QualityGateResults,
  taskRefs: Map<number, Set<string>>
): { summaries: DocumentAnalyticsGateSummary[]; docPaths: Set<string> } {
  const summaries: DocumentAnalyticsGateSummary[] = [];
  const docPaths = new Set<string>();

  for (const gateId of GATE_IDS) {
    const violations = Array.isArray(results?.[gateId]) ? results[gateId] : [];
    const severity = { error: 0, warn: 0, info: 0 } as const;
    const counts = { ...severity };
    const docs = collectViolationDocuments(violations);
    if (gateId.startsWith('DOC-')) {
      docs.forEach(doc => docPaths.add(doc));
    }

    for (const violation of violations) {
      const sev = extractSeverity(violation);
      counts[sev] += 1;
    }

    let impactedTasks = 0;
    if (docs.size > 0 && taskRefs.size > 0) {
      for (const refs of taskRefs.values()) {
        for (const doc of docs) {
          if (refs.has(doc)) {
            impactedTasks += 1;
            break;
          }
        }
      }
    }

    summaries.push({
      gateId,
      totalViolations: violations.length,
      uniqueDocuments: docs.size,
      severity: counts,
      impactedTasks
    });
  }

  return { summaries, docPaths };
}

export function collectDocumentAnalytics(input: CollectDocumentAnalyticsInput): DocumentAnalyticsSnapshot {
  const results: QualityGateResults = input.results ?? {};
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const taskSummary = summarizeTasks(tasks);

  const { summaries, docPaths } = buildGateSummary(results, taskSummary.references);
  const docStatusEntries = normalizeDocStatus(input.docStatus, docPaths);

  const docStatusCounts: Record<string, number> = {};
  for (const entry of docStatusEntries) {
    docStatusCounts[entry.status] = (docStatusCounts[entry.status] ?? 0) + 1;
  }

  const snapshot: DocumentAnalyticsSnapshot = {
    generatedAt: new Date().toISOString(),
    documents: {
      total: docStatusEntries.length,
      byStatus: docStatusCounts,
      withViolations: docPaths.size
    },
    tasks: {
      total: taskSummary.total,
      byStatus: taskSummary.byStatus
    },
    gates: summaries
  };

  return snapshot;
}

export { DOCUMENT_GATE_IDS as DOCUMENT_GATE_ORDER };
