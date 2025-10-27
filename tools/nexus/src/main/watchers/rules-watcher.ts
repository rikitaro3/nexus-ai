import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { ImpactScanResult, scanQualityGateImpacts } from '../utils/document-impact.js';
import {
  listQualityGateLogs,
  loadLatestQualityGateLog,
  QualityGateDiffSummary,
  QualityGateResults,
  QualityGateRunResult,
  runQualityGatesValidation,
  summarizeGateResults
} from '../utils/quality-gates.js';

export type RulesWatcherTrigger = 'init' | 'auto' | 'manual' | 'bulk';

export interface PipelineSegmentState {
  mode: 'auto' | 'manual' | 'bulk';
  status: 'idle' | 'running' | 'completed' | 'error';
  lastRunAt: string | null;
  logPath: string | null;
  exitCode: number | null;
  error?: string | null;
}

export interface QualityGateSnapshot {
  timestamp: string;
  mode: 'auto' | 'manual' | 'bulk';
  exitCode: number;
  summary: ReturnType<typeof summarizeGateResults>;
  diff: QualityGateDiffSummary | null;
  logPath: string | null;
  results: QualityGateResults;
  contextPath: string | null;
}

export interface RulesWatcherEvent {
  type: 'quality-gates:update';
  trigger: RulesWatcherTrigger;
  timestamp: string;
  impact: ImpactScanResult;
  pipeline: {
    state: {
      auto: PipelineSegmentState;
      semiAuto: PipelineSegmentState;
      manual: PipelineSegmentState;
    };
    lastRun: QualityGateSnapshot | null;
  };
  logs: Awaited<ReturnType<typeof listQualityGateLogs>>;
  message?: string;
  error?: { message: string; stack?: string };
}

interface RulesWatcherOptions {
  projectRoot: string;
  notify: (event: RulesWatcherEvent) => void;
  contextPath?: string | null;
}

interface RefreshOptions {
  trigger: RulesWatcherTrigger;
  runValidation: boolean;
  reason?: string;
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
  return 'manual';
}

function sanitizeResults(results: QualityGateResults | undefined | null): QualityGateResults {
  if (!results) return {};
  return JSON.parse(JSON.stringify(results));
}

export class RulesWatcherController {
  private projectRoot: string;
  private notify: (event: RulesWatcherEvent) => void;
  private contextOverride?: string | null;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private latestEvent: RulesWatcherEvent | null = null;
  private lastRun: QualityGateRunResult | null = null;
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
    const target = path.join(this.projectRoot, 'tools', 'nexus', 'docs', 'GATES', 'document.mdc');
    const dir = path.dirname(target);
    const base = path.basename(target);

    try {
      this.watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        if (filename.toString() !== base) return;
        if (eventType !== 'change' && eventType !== 'rename') return;
        this.scheduleRefresh({ trigger: 'auto', runValidation: true, reason: `fs:${eventType}` });
      });
      logger.info('Rules watcher initialized', { target });
    } catch (error) {
      logger.error('Failed to initialize rules watcher', {
        error: (error as Error).message,
        target
      });
    }
  }

  private scheduleRefresh(options: RefreshOptions) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(() => {
      this.refresh(options).catch(err => {
        logger.error('Rules watcher refresh failed', { error: (err as Error).message, trigger: options.trigger });
      });
    }, 400);
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

  private makeSnapshot(run: QualityGateRunResult | null): QualityGateSnapshot | null {
    if (!run) return null;
    return {
      timestamp: run.timestamp,
      mode: run.mode,
      exitCode: run.exitCode,
      summary: summarizeGateResults(run.payload?.results),
      diff: run.diff ?? null,
      logPath: run.relativeLogPath,
      results: sanitizeResults(run.payload?.results),
      contextPath: run.payload?.contextPath ?? null
    };
  }

  private async refresh(options: RefreshOptions): Promise<RulesWatcherEvent> {
    if (this.isDisposed) {
      throw new Error('Rules watcher already disposed');
    }

    await this.ensureLastRunLoaded();
    const impact = await scanQualityGateImpacts(this.projectRoot, this.contextOverride);
    let error: { message: string; stack?: string } | undefined;
    let runResult: QualityGateRunResult | null = this.lastRun;

    if (options.runValidation) {
      const segmentKey = mapTriggerToSegment(options.trigger);
      const segment = this.pipelineState[segmentKey];
      segment.status = 'running';
      segment.error = null;
      segment.lastRunAt = new Date().toISOString();
      try {
        const previousResults = this.lastRun?.payload?.results ?? null;
        runResult = await runQualityGatesValidation(this.projectRoot, {
          mode: segment.mode,
          contextPath: impact.contextPath ?? undefined,
          previousResults
        });
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

    const logs = await listQualityGateLogs(this.projectRoot);

    const event: RulesWatcherEvent = {
      type: 'quality-gates:update',
      trigger: options.trigger,
      timestamp: new Date().toISOString(),
      impact,
      pipeline: {
        state: this.clonePipelineState(),
        lastRun: this.makeSnapshot(runResult ?? null)
      },
      logs,
      message: options.reason,
      error
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
    return this.refresh({ trigger: 'init', runValidation: false, reason: 'manual-scan' });
  }

  async listLogs() {
    return listQualityGateLogs(this.projectRoot);
  }

  dispose() {
    this.isDisposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (error) {
        logger.warn('Failed to close rules watcher', { error: (error as Error).message });
      }
      this.watcher = null;
    }
  }
}

export function createRulesWatcher(options: RulesWatcherOptions) {
  return new RulesWatcherController(options);
}
