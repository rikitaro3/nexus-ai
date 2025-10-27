import * as fs from 'fs/promises';
import * as path from 'path';
import { collectDocumentAnalytics, DocumentAnalyticsSnapshot } from '../main/utils/document-analytics.js';
import { listQualityGateLogs, loadLatestQualityGateLog, QualityGateLogDescriptor } from '../main/utils/quality-gates.js';
import { ImpactScanResult, scanQualityGateImpacts } from '../main/utils/document-impact.js';
import type { QualityGateRunResult } from '../main/utils/quality-gates.js';

export interface TasksLoadResult {
  tasks: any[];
  warnings: string[];
}

export interface QualityGateTrendEntry {
  timestamp: string;
  exitCode: number;
  mode: 'auto' | 'manual' | 'bulk';
  totalViolations: number;
  severity: {
    error: number;
    warn: number;
    info: number;
  };
}

export interface MissingNodeEntry {
  path: string;
  category: string | null;
  message?: string;
}

export interface NexusAnalyticsDataset {
  generatedAt: string;
  projectRoot: string;
  contextPath: string | null;
  version: number;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    completed: number;
    completionRate: number;
    warnings: string[];
  };
  qualityGates: {
    latestRun: {
      timestamp: string;
      exitCode: number;
      mode: 'auto' | 'manual' | 'bulk';
      totalViolations: number;
      severity: {
        error: number;
        warn: number;
        info: number;
      };
      logPath: string | null;
    } | null;
    analytics: DocumentAnalyticsSnapshot;
  };
  dag: {
    missingNodes: MissingNodeEntry[];
    totalMissing: number;
    warnings: string[];
  };
  history: {
    qualityGateViolations: QualityGateTrendEntry[];
  };
}

const TASKS_FILENAME = path.join('tools', 'nexus', 'tasks.json');

function normalizeStatus(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) return 'UNKNOWN';
  return String(value).trim();
}

function isCompletedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'done' || normalized === 'completed' || normalized === 'complete' || normalized === '完了';
}

function summarizeTasksForAnalytics(tasks: any[]): {
  total: number;
  byStatus: Record<string, number>;
  completed: number;
  completionRate: number;
} {
  const byStatus: Record<string, number> = {};
  let completed = 0;

  for (const task of tasks) {
    const status = normalizeStatus(task?.status ?? 'UNKNOWN') || 'UNKNOWN';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (isCompletedStatus(status)) {
      completed += 1;
    }
  }

  const total = tasks.length;
  const completionRate = total > 0 ? completed / total : 0;

  return {
    total,
    byStatus,
    completed,
    completionRate
  };
}

function buildTrendEntries(logs: QualityGateLogDescriptor[]): QualityGateTrendEntry[] {
  return logs.slice(0, 24).map(log => {
    const severity = log.summary.reduce((acc, item) => {
      acc.error += item?.severity?.error ?? 0;
      acc.warn += item?.severity?.warn ?? 0;
      acc.info += item?.severity?.info ?? 0;
      return acc;
    }, { error: 0, warn: 0, info: 0 });

    const totalViolations = log.summary.reduce((acc, item) => acc + (item?.total ?? 0), 0);

    return {
      timestamp: log.timestamp,
      exitCode: log.exitCode,
      mode: log.mode,
      totalViolations,
      severity
    };
  });
}

function extractMissingNodes(impact: ImpactScanResult | null): MissingNodeEntry[] {
  if (!impact) return [];
  return (impact.documents || [])
    .filter(doc => doc.exists === false)
    .map(doc => ({
      path: doc.path,
      category: doc.category ?? null,
      message: doc.message
    }));
}

export async function loadTasksForAnalytics(projectRoot: string): Promise<TasksLoadResult> {
  const warnings: string[] = [];
  const target = path.join(projectRoot, TASKS_FILENAME);

  try {
    const text = await fs.readFile(target, 'utf8');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      warnings.push('tasks.json is not an array. Falling back to empty list.');
      return { tasks: [], warnings };
    }
    return { tasks: data, warnings };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      warnings.push('tasks.json not found. Using empty tasks dataset.');
      return { tasks: [], warnings };
    }
    warnings.push(`Failed to read tasks.json: ${(error as Error).message}`);
    return { tasks: [], warnings };
  }
}

async function loadLatestQualityGateLogSafe(projectRoot: string): Promise<QualityGateRunResult | null> {
  try {
    return await loadLatestQualityGateLog(projectRoot);
  } catch (error) {
    return null;
  }
}

async function loadQualityGateHistorySafe(projectRoot: string): Promise<QualityGateLogDescriptor[]> {
  try {
    return await listQualityGateLogs(projectRoot);
  } catch (error) {
    return [];
  }
}

export interface CollectAnalyticsOptions {
  contextOverride?: string | null;
}

export async function collectNexusAnalyticsDataset(projectRoot: string, options: CollectAnalyticsOptions = {}): Promise<NexusAnalyticsDataset> {
  const tasksResult = await loadTasksForAnalytics(projectRoot);
  const latestLog = await loadLatestQualityGateLogSafe(projectRoot);
  const historyLogs = await loadQualityGateHistorySafe(projectRoot);

  const contextOverride = options.contextOverride ?? latestLog?.payload?.contextPath ?? null;
  let impact: ImpactScanResult | null = null;
  try {
    impact = await scanQualityGateImpacts(projectRoot, contextOverride);
  } catch (error) {
    impact = null;
  }

  const analytics = collectDocumentAnalytics({
    results: latestLog?.payload?.results ?? null,
    docStatus: latestLog?.payload?.docStatus ?? null,
    tasks: tasksResult.tasks
  });

  const trendEntries = buildTrendEntries(historyLogs);
  const missingNodes = extractMissingNodes(impact);

  const latestSeverity = latestLog
    ? latestLog.summary.reduce((acc, item) => {
        acc.error += item?.severity?.error ?? 0;
        acc.warn += item?.severity?.warn ?? 0;
        acc.info += item?.severity?.info ?? 0;
        return acc;
      }, { error: 0, warn: 0, info: 0 })
    : { error: 0, warn: 0, info: 0 };

  const latestSummaryTotal = latestLog?.summary.reduce((acc, item) => acc + (item?.total ?? 0), 0) ?? 0;

  const tasksSummary = summarizeTasksForAnalytics(tasksResult.tasks);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    contextPath: impact?.contextPath ?? contextOverride,
    version: 1,
    tasks: {
      total: tasksSummary.total,
      byStatus: tasksSummary.byStatus,
      completed: tasksSummary.completed,
      completionRate: tasksSummary.completionRate,
      warnings: tasksResult.warnings
    },
    qualityGates: {
      latestRun: latestLog
        ? {
            timestamp: latestLog.timestamp,
            exitCode: latestLog.exitCode,
            mode: latestLog.mode,
            totalViolations: latestSummaryTotal,
            severity: latestSeverity,
            logPath: latestLog.relativeLogPath ?? null
          }
        : null,
      analytics
    },
    dag: {
      missingNodes,
      totalMissing: missingNodes.length,
      warnings: impact?.warnings ?? []
    },
    history: {
      qualityGateViolations: trendEntries
    }
  };
}
