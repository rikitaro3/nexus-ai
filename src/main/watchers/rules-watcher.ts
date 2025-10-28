import chokidar, { FSWatcher } from 'chokidar';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ImpactScanResult, RulesDiffEntry, RulesDiffPayload, scanQualityGateImpacts } from '../utils/document-impact';
import { collectDocumentAnalytics } from '../utils/document-analytics';
import {
  listQualityGateLogs,
  loadLatestQualityGateLog,
  runQualityGatesAutofix,
  runQualityGatesValidation,
  summarizeGateResults
} from '../utils/quality-gates';
import type {
  PipelineSegmentState,
  QualityGateSnapshot,
  RulesWatcherEvent,
  RulesWatcherTrigger,
  RulesWatcherLogList,
  QualityGateRunResultLike
} from '../../types/rules-watcher.js';
import type { QualityGateResults } from '../utils/quality-gates';

export type {
  PipelineSegmentState,
  QualityGateSnapshot,
  RulesWatcherEvent,
  RulesWatcherTrigger
} from '../../types/rules-watcher.js';

interface RulesWatcherOptions {
  projectRoot: string;
  notify: (event: RulesWatcherEvent) => void;
  contextPath?: string | null;
}

interface RefreshOptions {
  trigger: RulesWatcherTrigger;
  runValidation: boolean;
  reason?: string;
  diff?: RulesDiffPayload | null;
}

function createInitialSegment(mode: PipelineSegmentState['mode']): PipelineSegmentState {
  return {
    mode,
    status: 'idle',
    lastRunAt: null,
    logPath: null,
    exitCode: null,
    error: null
  };
}

function cloneSegment(segment: PipelineSegmentState): PipelineSegmentState {
  return { ...segment };
}

function mapTriggerToSegment(trigger: RulesWatcherTrigger): 'auto' | 'manual' | 'semiAuto' {
  if (trigger === 'auto') return 'auto';
  if (trigger === 'bulk') return 'semiAuto';
  if (trigger === 'context' || trigger === 'scan') return 'manual';
  return 'manual';
}

function sanitizeResults(results: QualityGateResults | undefined | null): QualityGateResults {
  if (!results) return {};
  return JSON.parse(JSON.stringify(results));
}

type RuleFileEvent = 'add' | 'change' | 'unlink';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value && value.trim().length > 0)));
}

function parseHeadings(content: string | null): string[] {
  if (!content) return [];
  const headings: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^#{1,6}\s+(.*)$/);
    if (match) {
      headings.push(match[1].trim());
    }
  }
  return uniqueStrings(headings);
}

function countLineDifferences(previous: string | null, next: string | null) {
  const previousLines = previous ? previous.split(/\r?\n/) : [];
  const nextLines = next ? next.split(/\r?\n/) : [];

  const previousCounts = new Map<string, number>();
  for (const line of previousLines) {
    previousCounts.set(line, (previousCounts.get(line) ?? 0) + 1);
  }

  const nextCounts = new Map<string, number>();
  for (const line of nextLines) {
    nextCounts.set(line, (nextCounts.get(line) ?? 0) + 1);
  }

  let added = 0;
  for (const [line, count] of nextCounts.entries()) {
    const previousCount = previousCounts.get(line) ?? 0;
    if (count > previousCount) {
      added += count - previousCount;
    }
  }

  let removed = 0;
  for (const [line, count] of previousCounts.entries()) {
    const nextCount = nextCounts.get(line) ?? 0;
    if (count > nextCount) {
      removed += count - nextCount;
    }
  }

  return {
    previousLineCount: previousLines.length,
    nextLineCount: nextLines.length,
    addedLines: added,
    removedLines: removed
  };
}

function createRuleDiffEntry(event: RuleFileEvent, relativePath: string, previous: string | null, next: string | null): RulesDiffEntry {
  const { previousLineCount, nextLineCount, addedLines, removedLines } = countLineDifferences(previous, next);
  const previousHeadings = parseHeadings(previous);
  const nextHeadings = parseHeadings(next);
  const addedHeadings = nextHeadings.filter(heading => !previousHeadings.includes(heading));
  const removedHeadings = previousHeadings.filter(heading => !nextHeadings.includes(heading));

  return {
    path: relativePath,
    event,
    previousLineCount,
    nextLineCount,
    addedLines,
    removedLines,
    addedHeadings: uniqueStrings(addedHeadings),
    removedHeadings: uniqueStrings(removedHeadings)
  };
}

export class RulesWatcherController {
  private projectRoot: string;
  private notify: (event: RulesWatcherEvent) => void;
  private contextOverride?: string | null;
  private watcher: FSWatcher | null = null;
  private watcherReady = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private latestEvent: RulesWatcherEvent | null = null;
  private lastRun: QualityGateRunResultLike = null;
  private pendingRuleDiffs: RulesDiffEntry[] = [];
  private ruleFileCache = new Map<string, string>();
  private pipelineState = {
    auto: createInitialSegment('auto'),
    semiAuto: createInitialSegment('bulk'),
    manual: createInitialSegment('manual')
  };
  private isDisposed = false;

  constructor(options: RulesWatcherOptions) {
    this.projectRoot = options.projectRoot;
    this.notify = options.notify;
    this.contextOverride = options.contextPath;
    this.setupWatcher();
  }

  private setupWatcher() {
    const rulesDir = path.join(this.projectRoot, 'docs', 'GATES');
    const pattern = path.join(rulesDir, '**', '*.mdc');

    try {
      this.watcher = chokidar.watch(pattern, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 50
        }
      });

      this.watcher
        .on('add', (filePath: string) => {
          void this.handleRuleFileEvent('add', filePath);
        })
        .on('change', (filePath: string) => {
          void this.handleRuleFileEvent('change', filePath);
        })
        .on('unlink', (filePath: string) => {
          void this.handleRuleFileEvent('unlink', filePath);
        })
        .on('ready', () => {
          this.watcherReady = true;
          logger.info('Rules watcher initialized', { target: pattern });
        })
        .on('error', (error: Error) => {
          logger.error('Rules watcher error', {
            error: (error as Error).message,
            target: pattern
          });
        });
    } catch (error) {
      logger.error('Failed to initialize rules watcher', {
        error: (error as Error).message,
        target: pattern
      });
    }
  }

  private scheduleRefresh(options: RefreshOptions) {
    if (this.isDisposed) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const diff = this.drainPendingRuleDiffs();
      this.refresh({ ...options, diff }).catch(err => {
        logger.error('Rules watcher refresh failed', { error: (err as Error).message, trigger: options.trigger });
      });
    }, 400);
  }

  private async handleRuleFileEvent(event: RuleFileEvent, filePath: string) {
    if (this.isDisposed) return;

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);
    const relativePath = path.relative(this.projectRoot, absolutePath);

    try {
      const diff = await this.computeRuleDiff(event, absolutePath, relativePath);
      if (!diff) return;

      if (!this.watcherReady && event === 'add') {
        return;
      }

      this.recordPendingRuleDiff(diff);
      this.scheduleRefresh({
        trigger: 'auto',
        runValidation: true,
        reason: `rules:${event}:${relativePath}`
      });
    } catch (error) {
      logger.error('Failed to process rules watcher event', {
        error: (error as Error).message,
        event,
        file: relativePath
      });
    }
  }

  private async computeRuleDiff(event: RuleFileEvent, absolutePath: string, relativePath: string): Promise<RulesDiffEntry | null> {
    const previous = this.ruleFileCache.get(absolutePath) ?? null;
    let next: string | null = null;

    if (event === 'unlink') {
      this.ruleFileCache.delete(absolutePath);
    } else {
      try {
        next = await readFile(absolutePath, 'utf8');
        this.ruleFileCache.set(absolutePath, next);
      } catch (error) {
        logger.warn('Failed to read rules document for diff summary', {
          error: (error as Error).message,
          file: relativePath
        });
        return null;
      }
    }

    if (event === 'change' && previous !== null && next !== null && previous === next) {
      return null;
    }

    return createRuleDiffEntry(event, relativePath, previous, next);
  }

  private recordPendingRuleDiff(diff: RulesDiffEntry) {
    this.pendingRuleDiffs.push({
      ...diff,
      addedHeadings: uniqueStrings(diff.addedHeadings),
      removedHeadings: uniqueStrings(diff.removedHeadings)
    });
  }

  private drainPendingRuleDiffs(): RulesDiffPayload | null {
    if (this.pendingRuleDiffs.length === 0) {
      return null;
    }

    const files = this.pendingRuleDiffs.map(diff => ({
      ...diff,
      addedHeadings: uniqueStrings(diff.addedHeadings),
      removedHeadings: uniqueStrings(diff.removedHeadings)
    }));
    this.pendingRuleDiffs = [];
    return { files };
  }

  private async ensureLastRunLoaded() {
    if (this.lastRun) return;
    try {
      const latest = await loadLatestQualityGateLog(this.projectRoot);
      if (latest) {
        this.lastRun = latest;
        const segmentKey = mapTriggerToSegment(latest.mode);
        this.pipelineState[segmentKey].lastRunAt = latest.timestamp;
        this.pipelineState[segmentKey].logPath = latest.relativeLogPath;
        this.pipelineState[segmentKey].exitCode = latest.exitCode;
        this.pipelineState[segmentKey].status = 'completed';
      }
    } catch (error) {
      logger.warn('Failed to load latest Quality Gate log', { error: (error as Error).message });
    }
  }

  private clonePipelineState() {
    return {
      auto: cloneSegment(this.pipelineState.auto),
      semiAuto: cloneSegment(this.pipelineState.semiAuto),
      manual: cloneSegment(this.pipelineState.manual)
    };
  }

  private makeSnapshot(run: QualityGateRunResultLike): QualityGateSnapshot | null {
    if (!run) return null;
    return {
      timestamp: run.timestamp,
      mode: run.mode,
      exitCode: run.exitCode,
      summary: summarizeGateResults(run.payload?.results),
      diff: run.diff ?? null,
      logPath: run.relativeLogPath,
      results: sanitizeResults(run.payload?.results),
      contextPath: run.payload?.contextPath ?? null,
      autofix: run.autofix ?? null,
      repoDiff: run.repoDiff ?? null
    };
  }

  private async refresh(options: RefreshOptions): Promise<RulesWatcherEvent> {
    if (this.isDisposed) {
      throw new Error('Rules watcher already disposed');
    }

    const rulesDiff = options.diff ?? this.drainPendingRuleDiffs();
    await this.ensureLastRunLoaded();
    const impact = await scanQualityGateImpacts(this.projectRoot, this.contextOverride, { rulesDiff });
    let error: { message: string; stack?: string } | undefined;
    let runResult: QualityGateRunResultLike = this.lastRun;

    if (options.runValidation) {
      const segmentKey = mapTriggerToSegment(options.trigger);
      const segment = this.pipelineState[segmentKey];
      segment.status = 'running';
      segment.error = null;
      segment.lastRunAt = new Date().toISOString();
      try {
        const previousResults = this.lastRun?.payload?.results ?? null;
        if (segment.mode === 'bulk') {
          runResult = await runQualityGatesAutofix(this.projectRoot, {
            contextPath: impact.contextPath ?? undefined,
            previousResults
          });
        } else {
          runResult = await runQualityGatesValidation(this.projectRoot, {
            mode: segment.mode,
            contextPath: impact.contextPath ?? undefined,
            previousResults
          });
        }
        this.lastRun = runResult;
        segment.status = 'completed';
        segment.lastRunAt = runResult.timestamp;
        segment.logPath = runResult.relativeLogPath;
        segment.exitCode = runResult.exitCode;
      } catch (err) {
        const message = (err as Error).message;
        segment.status = 'error';
        segment.error = message;
        error = { message, stack: (err as Error).stack };
      }
    }

    const logs: RulesWatcherLogList = await listQualityGateLogs(this.projectRoot);
    const analytics = collectDocumentAnalytics({
      results: runResult?.payload?.results ?? null,
      docStatus: runResult?.payload?.docStatus ?? null
    });

    const event: RulesWatcherEvent = {
      type: 'quality-gates:update',
      trigger: options.trigger,
      timestamp: new Date().toISOString(),
      impact,
      rulesDiff: rulesDiff ?? null,
      pipeline: {
        state: this.clonePipelineState(),
        lastRun: this.makeSnapshot(runResult ?? null)
      },
      logs,
      analytics,
      message: options.reason,
      error,
      autofix: runResult?.autofix ?? null,
      repoDiff: runResult?.repoDiff ?? null
    };

    this.latestEvent = event;
    this.notify(event);
    return event;
  }

  async getLatest(): Promise<RulesWatcherEvent> {
    if (this.latestEvent) return this.latestEvent;
    return this.refresh({ trigger: 'init', runValidation: false });
  }

  async revalidate(mode: 'manual' | 'bulk'): Promise<RulesWatcherEvent> {
    const trigger: RulesWatcherTrigger = mode === 'bulk' ? 'bulk' : 'manual';
    return this.refresh({ trigger, runValidation: true, reason: `user:${mode}` });
  }

  async scanOnly(): Promise<RulesWatcherEvent> {
    return this.refresh({ trigger: 'scan', runValidation: false, reason: 'manual-scan' });
  }

  async listLogs(): Promise<RulesWatcherLogList> {
    return listQualityGateLogs(this.projectRoot);
  }

  async setContextPath(contextPath: string | null): Promise<RulesWatcherEvent> {
    if (this.isDisposed) {
      throw new Error('Rules watcher already disposed');
    }
    const normalized = typeof contextPath === 'string' && contextPath.trim() ? contextPath.trim() : null;
    this.contextOverride = normalized;
    return this.refresh({
      trigger: 'context',
      runValidation: false,
      reason: normalized ? `context:set:${normalized}` : 'context:clear'
    });
  }

  dispose() {
    this.isDisposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingRuleDiffs = [];
    this.ruleFileCache.clear();
    this.watcherReady = false;
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      watcher
        .close()
        .catch((error: unknown) => {
          logger.warn('Failed to close rules watcher', { error: (error as Error).message });
        });
    }
  }
}

export function createRulesWatcher(options: RulesWatcherOptions) {
  return new RulesWatcherController(options);
}
