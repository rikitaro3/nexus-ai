import type { ImpactScanResult, RulesDiffPayload } from '../main/utils/document-impact.js';
import type { DocumentAnalyticsSnapshot } from '../main/utils/document-analytics.js';
import type {
  DocsAutofixSummary,
  QualityGateDiffSummary,
  QualityGateResults,
  QualityGateRunResult,
  QualityGateSummaryItem,
  RepoDiffSummary
} from '../main/utils/quality-gates.js';

type ListQualityGateLogsFn = typeof import('../main/utils/quality-gates.js')['listQualityGateLogs'];

export type RulesWatcherTrigger = 'init' | 'auto' | 'manual' | 'bulk' | 'context' | 'scan';

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
  summary: QualityGateSummaryItem[];
  diff: QualityGateDiffSummary | null;
  logPath: string | null;
  results: QualityGateResults;
  contextPath: string | null;
  autofix: DocsAutofixSummary | null;
  repoDiff: RepoDiffSummary | null;
}

export interface RulesWatcherPipelineState {
  state: {
    auto: PipelineSegmentState;
    semiAuto: PipelineSegmentState;
    manual: PipelineSegmentState;
  };
  lastRun: QualityGateSnapshot | null;
}

export interface RulesWatcherEvent {
  type: 'quality-gates:update';
  trigger: RulesWatcherTrigger;
  timestamp: string;
  impact: ImpactScanResult;
  rulesDiff?: RulesDiffPayload | null;
  pipeline: RulesWatcherPipelineState;
  logs: Awaited<ReturnType<ListQualityGateLogsFn>>;
  analytics: DocumentAnalyticsSnapshot;
  message?: string;
  error?: { message: string; stack?: string };
  autofix?: DocsAutofixSummary | null;
  repoDiff?: RepoDiffSummary | null;
}

export interface RulesWatcherEventEnvelope {
  success: boolean;
  event?: RulesWatcherEvent;
  error?: string;
}

export type RulesWatcherLogList = Awaited<ReturnType<ListQualityGateLogsFn>>;

export type QualityGateRunResultLike = QualityGateRunResult | null | undefined;
