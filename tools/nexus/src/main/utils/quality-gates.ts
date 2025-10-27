import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from './logger.js';

export interface QualityGateViolation {
  path?: string;
  message?: string;
  severity?: 'error' | 'warn' | 'info' | string;
  link?: string;
  heading?: string;
  layer?: string;
  cycle?: string[];
  [key: string]: unknown;
}

export type QualityGateResults = Record<string, QualityGateViolation[]>;

export interface QualityGateSummaryItem {
  gateId: string;
  total: number;
  severity: {
    error: number;
    warn: number;
    info: number;
  };
}

export interface QualityGateDiffItem {
  gateId: string;
  added: QualityGateViolation[];
  removed: QualityGateViolation[];
}

export interface QualityGateDiffSummary {
  totalAdded: number;
  totalRemoved: number;
  perGate: QualityGateDiffItem[];
}

export interface QualityGatePayload {
  results: QualityGateResults;
  contextPath?: string | null;
  projectRoot?: string;
  docStatus?: Record<string, unknown>;
}

export interface DocsAutofixRenameEntry {
  from: string;
  to: string;
  reason?: string;
}

export interface DocsAutofixOperation {
  type: 'modify' | 'rename';
  path?: string;
  actions?: string[];
  from?: string;
  to?: string;
  reason?: string;
}

export interface DocsAutofixSummary {
  status: 'ok' | 'failed';
  timestamp: string;
  projectRoot: string;
  contextPath?: string | null;
  dryRun: boolean;
  operations: DocsAutofixOperation[];
  renameMap: DocsAutofixRenameEntry[];
  files: string[];
  warnings: string[];
  errors: string[];
  rawOutput: string;
  stderr: string;
  exitCode: number;
}

export interface RepoDiffSummary {
  nameStatus: string;
  patch: string;
  files: string[];
}

export interface QualityGateRunResult {
  timestamp: string;
  mode: 'auto' | 'manual' | 'bulk';
  exitCode: number;
  payload: QualityGatePayload;
  summary: QualityGateSummaryItem[];
  diff: QualityGateDiffSummary | null;
  autofix: DocsAutofixSummary | null;
  repoDiff: RepoDiffSummary | null;
  logPath: string;
  relativeLogPath: string;
  rawOutput: string;
  stderr: string;
}

interface QualityGateLogFile {
  timestamp: string;
  mode: 'auto' | 'manual' | 'bulk';
  exitCode: number;
  payload: QualityGatePayload;
  summary: QualityGateSummaryItem[];
  diff: QualityGateDiffSummary | null;
  autofix?: DocsAutofixSummary | null;
  repoDiff?: RepoDiffSummary | null;
  stdout?: string;
  rawOutput?: string;
  stderr?: string;
  relativeLogPath?: string;
}

export interface QualityGateLogDescriptor {
  timestamp: string;
  mode: 'auto' | 'manual' | 'bulk';
  exitCode: number;
  relativePath: string;
  absolutePath: string;
  summary: QualityGateSummaryItem[];
}

interface RunOptions {
  mode: 'auto' | 'manual' | 'bulk';
  contextPath?: string | null;
  previousResults?: QualityGateResults | null;
  autofixDryRun?: boolean;
}

const LOG_DIR = path.join('tools', 'nexus', 'logs', 'quality-gates');
const DEFAULT_GATE_ORDER = [
  'DOC-01',
  'DOC-02',
  'DOC-03',
  'DOC-04',
  'DOC-05',
  'DOC-06',
  'DOC-07',
  'DOC-08',
  'TC-01',
  'TC-02',
  'TC-03',
  'TC-04'
] as const;

function sortGateIds(gateIds: string[]): string[] {
  const order = new Map<string, number>();
  DEFAULT_GATE_ORDER.forEach((gateId, index) => order.set(gateId, index));
  return gateIds.sort((a, b) => {
    const aIndex = order.get(a);
    const bIndex = order.get(b);
    if (typeof aIndex === 'number' && typeof bIndex === 'number') {
      return aIndex - bIndex;
    }
    if (typeof aIndex === 'number') return -1;
    if (typeof bIndex === 'number') return 1;
    return a.localeCompare(b);
  });
}

function sanitizeTimestampForFilename(iso: string): string {
  return iso.replace(/[:]/g, '-');
}

export function summarizeGateResults(results: QualityGateResults | undefined | null): QualityGateSummaryItem[] {
  if (!results) return [];
  const summary: QualityGateSummaryItem[] = [];
  const gateIds = sortGateIds([
    ...new Set([
      ...Object.keys(results),
      ...DEFAULT_GATE_ORDER
    ])
  ]);

  for (const gateId of gateIds) {
    const violations = Array.isArray(results?.[gateId]) ? results[gateId] : [];
    const counts = { error: 0, warn: 0, info: 0 };
    for (const violation of violations) {
      const severity = (violation?.severity ?? 'info').toString().toLowerCase() as 'error' | 'warn' | 'info';
      if (severity === 'error' || severity === 'warn' || severity === 'info') {
        counts[severity] += 1;
      } else {
        counts.info += 1;
      }
    }
    summary.push({ gateId, total: violations.length, severity: counts });
  }

  return summary;
}

function buildViolationKey(violation: QualityGateViolation): string {
  const parts = [
    violation.path ?? '',
    violation.message ?? '',
    violation.link ?? '',
    violation.heading ?? '',
    violation.layer ?? '',
    Array.isArray(violation.cycle) ? violation.cycle.join('>') : ''
  ];
  return parts.join('::');
}

export function computeGateDiff(previous: QualityGateResults | null | undefined, next: QualityGateResults | null | undefined): QualityGateDiffSummary | null {
  if (!next) {
    if (!previous) return null;
    const removedTotal = Object.values(previous).reduce((acc, arr) => acc + (arr?.length ?? 0), 0);
    return { totalAdded: 0, totalRemoved: removedTotal, perGate: [] };
  }

  const diff: QualityGateDiffSummary = {
    totalAdded: 0,
    totalRemoved: 0,
    perGate: []
  };

  const gateIds = new Set<string>([
    ...Object.keys(previous ?? {}),
    ...Object.keys(next ?? {}),
    ...DEFAULT_GATE_ORDER
  ]);

  for (const gateId of sortGateIds(Array.from(gateIds))) {
    const prevRaw = previous?.[gateId];
    const nextRaw = next?.[gateId];
    const prevList = Array.isArray(prevRaw) ? prevRaw : [];
    const nextList = Array.isArray(nextRaw) ? nextRaw : [];
    const prevMap = new Map(prevList.map(item => [buildViolationKey(item), item]));
    const nextMap = new Map(nextList.map(item => [buildViolationKey(item), item]));

    const added: QualityGateViolation[] = [];
    const removed: QualityGateViolation[] = [];

    for (const [key, violation] of nextMap.entries()) {
      if (!prevMap.has(key)) {
        added.push(violation);
      }
    }

    for (const [key, violation] of prevMap.entries()) {
      if (!nextMap.has(key)) {
        removed.push(violation);
      }
    }

    if (added.length || removed.length) {
      diff.perGate.push({ gateId, added, removed });
    }

    diff.totalAdded += added.length;
    diff.totalRemoved += removed.length;
  }

  if (diff.perGate.length === 0) {
    return { totalAdded: 0, totalRemoved: 0, perGate: [] };
  }

  return diff;
}

async function ensureLogDirectory(projectRoot: string): Promise<string> {
  const target = path.join(projectRoot, LOG_DIR);
  await fs.mkdir(target, { recursive: true });
  return target;
}

async function resolveScriptPath(projectRoot: string): Promise<string> {
  const scriptPath = path.join(projectRoot, 'tools', 'nexus', 'scripts', 'validate-docs-gates.js');
  await fs.access(scriptPath);
  return scriptPath;
}

async function resolveAutofixScriptPath(projectRoot: string): Promise<string> {
  const scriptPath = path.join(projectRoot, 'tools', 'nexus', 'scripts', 'apply-docs-gates.js');
  await fs.access(scriptPath);
  return scriptPath;
}

async function runDocsAutofix(projectRoot: string, options: { contextPath?: string | null; dryRun?: boolean } = {}): Promise<DocsAutofixSummary> {
  const scriptPath = await resolveAutofixScriptPath(projectRoot);
  const args = [
    scriptPath,
    '--project-root',
    projectRoot,
    '--json'
  ];

  if (options.contextPath) {
    args.push('--context', options.contextPath);
  }

  if (options.dryRun) {
    args.push('--dry-run');
  }

  logger.info('Running Docs Quality Gates autofix', {
    projectRoot,
    contextPath: options.contextPath,
    dryRun: !!options.dryRun,
    scriptPath
  });

  const child = spawn(process.execPath, args, { cwd: projectRoot });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });

  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 0));
  });

  let summary: DocsAutofixSummary;
  try {
    summary = stdout.trim()
      ? JSON.parse(stdout) as DocsAutofixSummary
      : {
          status: exitCode === 0 ? 'ok' : 'failed',
          timestamp: new Date().toISOString(),
          projectRoot,
          contextPath: options.contextPath ?? null,
          dryRun: !!options.dryRun,
          operations: [],
          renameMap: [],
          files: [],
          warnings: [],
          errors: [],
          rawOutput: '',
          stderr: '',
          exitCode
        };
  } catch (error) {
    logger.error('Failed to parse Docs autofix output', {
      error: (error as Error).message,
      stdout
    });
    throw new Error(`Failed to parse Docs autofix output: ${(error as Error).message}`);
  }

  if (!Array.isArray(summary.operations)) {
    summary.operations = [];
  }
  if (!Array.isArray(summary.renameMap)) {
    summary.renameMap = [];
  }
  if (!Array.isArray(summary.files)) {
    summary.files = [];
  }
  if (!Array.isArray(summary.warnings)) {
    summary.warnings = [];
  }
  if (!Array.isArray(summary.errors)) {
    summary.errors = [];
  }

  summary.rawOutput = stdout.trim();
  summary.stderr = stderr.trim();
  summary.exitCode = exitCode;
  summary.status = summary.status ?? (exitCode === 0 ? 'ok' : 'failed');
  summary.projectRoot = summary.projectRoot ?? projectRoot;
  summary.contextPath = summary.contextPath ?? options.contextPath ?? null;
  summary.dryRun = !!options.dryRun;

  if (exitCode !== 0 || summary.status !== 'ok') {
    const message = summary.errors.length > 0
      ? summary.errors[0]
      : `Docs autofix failed with exit code ${exitCode}`;
    const error = new Error(message) as Error & { autofix?: DocsAutofixSummary };
    error.autofix = summary;
    throw error;
  }

  return summary;
}

async function runGitCommand(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: projectRoot });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('close', code => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

async function collectRepoDiff(projectRoot: string): Promise<RepoDiffSummary | null> {
  try {
    const nameStatusResult = await runGitCommand(projectRoot, ['diff', '--name-status']);
    if (nameStatusResult.exitCode !== 0) {
      logger.warn('Failed to collect git name-status diff', {
        exitCode: nameStatusResult.exitCode,
        stderr: nameStatusResult.stderr.trim()
      });
      return null;
    }

    const trimmedNameStatus = nameStatusResult.stdout.trim();
    if (!trimmedNameStatus) {
      return { nameStatus: '', patch: '', files: [] };
    }

    const patchResult = await runGitCommand(projectRoot, ['diff']);
    if (patchResult.exitCode !== 0) {
      logger.warn('Failed to collect git diff patch', {
        exitCode: patchResult.exitCode,
        stderr: patchResult.stderr.trim()
      });
    }

    const files = trimmedNameStatus
      .split('\n')
      .map(line => line.trim().split(/\s+/)[1])
      .filter((line): line is string => Boolean(line));

    return {
      nameStatus: trimmedNameStatus,
      patch: patchResult.exitCode === 0 ? patchResult.stdout : '',
      files
    };
  } catch (error) {
    logger.warn('Failed to collect repository diff', { error: (error as Error).message });
    return null;
  }
}

export async function runQualityGatesValidation(projectRoot: string, options: RunOptions): Promise<QualityGateRunResult> {
  const timestamp = new Date().toISOString();
  const scriptPath = await resolveScriptPath(projectRoot);
  const logDir = await ensureLogDirectory(projectRoot);
  const shouldAutofix = options.mode === 'bulk' || !!options.autofixDryRun;
  let autofix: DocsAutofixSummary | null = null;
  let repoDiff: RepoDiffSummary | null = null;

  if (shouldAutofix) {
    try {
      autofix = await runDocsAutofix(projectRoot, {
        contextPath: options.contextPath ?? null,
        dryRun: !!options.autofixDryRun
      });
      repoDiff = await collectRepoDiff(projectRoot);
    } catch (error) {
      const autofixSummary = (error as Error & { autofix?: DocsAutofixSummary }).autofix;
      if (autofixSummary) {
        logger.error('Docs Quality Gates autofix failed', {
          errors: autofixSummary.errors,
          status: autofixSummary.status,
          exitCode: autofixSummary.exitCode
        });
      }
      throw error;
    }
  }

  const args = [
    scriptPath,
    '--project-root',
    projectRoot,
    '--json'
  ];

  if (options.contextPath) {
    args.push('--context', options.contextPath);
  }

  logger.info('Running Quality Gates validation', {
    projectRoot,
    mode: options.mode,
    contextPath: options.contextPath,
    scriptPath
  });

  const child = spawn(process.execPath, args, { cwd: projectRoot });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });

  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 0));
  });

  let payload: QualityGatePayload;
  try {
    payload = stdout.trim() ? JSON.parse(stdout) : { results: {} };
  } catch (error) {
    logger.error('Failed to parse Quality Gates output', {
      error: (error as Error).message,
      stdout
    });
    throw new Error(`Failed to parse Quality Gates output: ${(error as Error).message}`);
  }

  const summary = summarizeGateResults(payload.results);
  const diff = computeGateDiff(options.previousResults, payload.results);

  const filename = `${sanitizeTimestampForFilename(timestamp)}-${options.mode}.json`;
  const logPath = path.join(logDir, filename);
  const relativeLogPath = path.relative(projectRoot, logPath);

  const logPayload: QualityGateLogFile = {
    timestamp,
    mode: options.mode,
    exitCode,
    payload,
    summary,
    diff,
    autofix,
    repoDiff,
    rawOutput: stdout.trim(),
    stderr: stderr.trim(),
    relativeLogPath
  };

  await fs.writeFile(logPath, JSON.stringify(logPayload, null, 2), 'utf8');

  logger.info('Quality Gates validation finished', {
    exitCode,
    mode: options.mode,
    relativeLogPath
  });

  return {
    timestamp,
    mode: options.mode,
    exitCode,
    payload,
    summary,
    diff,
    autofix,
    repoDiff,
    logPath,
    relativeLogPath,
    rawOutput: stdout.trim(),
    stderr: stderr.trim()
  };
}

export async function runQualityGatesAutofix(projectRoot: string, options: Omit<RunOptions, 'mode'> & { dryRun?: boolean } = {}): Promise<QualityGateRunResult> {
  return runQualityGatesValidation(projectRoot, {
    mode: 'bulk',
    contextPath: options.contextPath ?? null,
    previousResults: options.previousResults ?? null,
    autofixDryRun: options.dryRun ?? false
  });
}

export async function loadLatestQualityGateLog(projectRoot: string): Promise<QualityGateRunResult | null> {
  const dir = path.join(projectRoot, LOG_DIR);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const jsonFiles = files.filter(name => name.endsWith('.json'));
  if (jsonFiles.length === 0) return null;

  const entries = await Promise.all(jsonFiles.map(async file => {
    const absolutePath = path.join(dir, file);
    const stat = await fs.stat(absolutePath);
    return { file, absolutePath, mtimeMs: stat.mtimeMs };
  }));

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = entries[0];

  const text = await fs.readFile(latest.absolutePath, 'utf8');
  const data = JSON.parse(text) as QualityGateLogFile;

  return {
    timestamp: data.timestamp,
    mode: data.mode,
    exitCode: data.exitCode,
    payload: data.payload,
    summary: data.summary,
    diff: data.diff ?? null,
    autofix: data.autofix ?? null,
    repoDiff: data.repoDiff ?? null,
    logPath: latest.absolutePath,
    relativeLogPath: path.relative(projectRoot, latest.absolutePath),
    rawOutput: data.rawOutput ?? data.stdout ?? '',
    stderr: data.stderr ?? ''
  };
}

export async function listQualityGateLogs(projectRoot: string): Promise<QualityGateLogDescriptor[]> {
  const dir = path.join(projectRoot, LOG_DIR);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const descriptors: QualityGateLogDescriptor[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const absolutePath = path.join(dir, file);
    try {
      const text = await fs.readFile(absolutePath, 'utf8');
      const payload = JSON.parse(text) as QualityGateLogFile;
      const summary = Array.isArray(payload.summary)
        ? payload.summary as QualityGateSummaryItem[]
        : summarizeGateResults(payload.payload?.results);

      descriptors.push({
        timestamp: payload.timestamp,
        mode: payload.mode,
        exitCode: payload.exitCode,
        relativePath: path.relative(projectRoot, absolutePath),
        absolutePath,
        summary
      });
    } catch (error) {
      logger.warn('Failed to parse Quality Gate log entry', {
        error: (error as Error).message,
        file: absolutePath
      });
    }
  }

  descriptors.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return descriptors;
}
