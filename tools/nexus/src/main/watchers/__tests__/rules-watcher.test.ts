import path from 'path';
import type { RulesWatcherEvent } from '../rules-watcher';

let createRulesWatcher: typeof import('../rules-watcher').createRulesWatcher;

type MockWatcher = {
  on: jest.Mock<MockWatcher, [string, (...args: any[]) => void]>;
  emit: (event: string, ...args: any[]) => Promise<void>;
  close: jest.Mock<Promise<void>, []>;
};

const readFileMock = jest.fn<Promise<string>, [string, string?]>();
const accessMock = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
const readdirMock = jest.fn<Promise<string[]>, [string]>(() => Promise.resolve([]));

const scanQualityGateImpacts = jest.fn(async (_projectRoot: string, _context?: string | null, options?: any) => ({
  scannedAt: new Date().toISOString(),
  projectRoot: _projectRoot,
  contextPath: null,
  documents: [],
  summary: { total: 0, missing: 0, unreadable: 0, categories: {} },
  warnings: [],
  rulesDiff: options?.rulesDiff ?? null
}));

const runQualityGatesValidation = jest.fn(async () => ({
  timestamp: '2024-01-01T00:00:00.000Z',
  mode: 'auto' as const,
  exitCode: 0,
  payload: { results: {}, contextPath: null, docStatus: null },
  summary: [],
  diff: null,
  autofix: null,
  repoDiff: null,
  logPath: '/tmp/log',
  relativeLogPath: 'logs/log.json',
  rawOutput: '',
  stderr: ''
}));

const runQualityGatesAutofix = jest.fn(runQualityGatesValidation);
const listQualityGateLogs = jest.fn(async () => []);
const loadLatestQualityGateLog = jest.fn(async () => null);
const summarizeGateResults = jest.fn(() => []);
const collectDocumentAnalytics = jest.fn(() => ({ totals: {} }));

const mockWatchInstances: MockWatcher[] = [];

jest.mock('chokidar', () => {
  const watch = jest.fn((_pattern: string) => {
    const listeners = new Map<string, Array<(...args: any[]) => unknown>>();
    const instance: MockWatcher = {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(handler);
        return instance;
      }),
      emit: async (event: string, ...args: any[]) => {
        const handlers = listeners.get(event) ?? [];
        for (const handler of handlers) {
          await handler(...args);
        }
      },
      close: jest.fn(async () => {})
    };
    mockWatchInstances.push(instance);
    return instance;
  }) as unknown as jest.Mock & { __getInstances: () => MockWatcher[]; __reset: () => void };

  (watch as any).__getInstances = () => mockWatchInstances;
  (watch as any).__reset = () => {
    mockWatchInstances.splice(0, mockWatchInstances.length);
  };

  return {
    __esModule: true,
    default: Object.assign(watch, { watch })
  };
}, { virtual: true });

jest.mock('fs/promises', () => ({
  get readFile() {
    return readFileMock;
  },
  access: accessMock,
  readdir: readdirMock
}));

jest.mock('../../utils/document-impact', () => ({
  scanQualityGateImpacts
}));

jest.mock('../../utils/quality-gates', () => ({
  runQualityGatesValidation,
  runQualityGatesAutofix,
  listQualityGateLogs,
  loadLatestQualityGateLog,
  summarizeGateResults
}));

jest.mock('../../utils/document-analytics', () => ({
  collectDocumentAnalytics
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('RulesWatcherController', () => {
  const PROJECT_ROOT = '/project';
  const RULE_PATH = path.join(PROJECT_ROOT, 'docs', 'GATES', 'document.mdc');

  const getMockWatcher = () => {
    const chokidarModule = require('chokidar');
    const watchMock = chokidarModule.default as jest.Mock & { __getInstances: () => MockWatcher[] };
    const instances = watchMock.__getInstances();
    if (!instances.length) {
      throw new Error('Watcher not initialized');
    }
    return instances[0];
  };

  beforeEach(() => {
    jest.useFakeTimers();
    readFileMock.mockReset();
    accessMock.mockReset();
    accessMock.mockResolvedValue(undefined);
    readdirMock.mockReset();
    readdirMock.mockResolvedValue([]);
    scanQualityGateImpacts.mockClear();
    runQualityGatesValidation.mockClear();
    listQualityGateLogs.mockClear();
    loadLatestQualityGateLog.mockClear();
    summarizeGateResults.mockClear();
    collectDocumentAnalytics.mockClear();
    const chokidarModule = require('chokidar');
    const watchMock = chokidarModule.default as jest.Mock & { __reset: () => void };
    watchMock.__reset();
    mockWatchInstances.splice(0, mockWatchInstances.length);
    jest.isolateModules(() => {
      ({ createRulesWatcher } = require('../rules-watcher'));
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits diff summary for rule changes', async () => {
    readFileMock.mockResolvedValueOnce('## Heading\nOriginal line');

    const notify = jest.fn();
    createRulesWatcher({ projectRoot: PROJECT_ROOT, notify });

    const watcher = getMockWatcher();

    await watcher.emit('add', RULE_PATH);
    await watcher.emit('ready');

    readFileMock.mockResolvedValueOnce('## Heading\nUpdated line\n### Section');
    await watcher.emit('change', RULE_PATH);

    await jest.advanceTimersByTimeAsync(400);
    await Promise.resolve();

    expect(notify).toHaveBeenCalledTimes(1);
    const event = notify.mock.calls[0][0] as RulesWatcherEvent;
    expect(event.rulesDiff).not.toBeNull();
    expect(event.rulesDiff?.files).toHaveLength(1);
    expect(event.rulesDiff?.files[0]).toMatchObject({
      path: path.relative(PROJECT_ROOT, RULE_PATH),
      event: 'change',
      previousLineCount: 2,
      nextLineCount: 3,
      addedLines: 2,
      removedLines: 1,
      addedHeadings: ['Section']
    });
    expect(runQualityGatesValidation).toHaveBeenCalledTimes(1);
    expect(scanQualityGateImpacts).toHaveBeenCalledWith(
      PROJECT_ROOT,
      undefined,
      expect.objectContaining({
        rulesDiff: expect.objectContaining({ files: expect.any(Array) })
      })
    );
  });

  it('stops scheduling refreshes after dispose', async () => {
    readFileMock.mockResolvedValueOnce('## Heading\nOriginal line');

    const notify = jest.fn();
    const controller = createRulesWatcher({ projectRoot: PROJECT_ROOT, notify });
    const watcher = getMockWatcher();

    await watcher.emit('add', RULE_PATH);
    await watcher.emit('ready');

    readFileMock.mockResolvedValueOnce('## Heading\nUpdated line');
    await watcher.emit('change', RULE_PATH);

    controller.dispose();

    await jest.advanceTimersByTimeAsync(400);
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
    expect(watcher.close).toHaveBeenCalledTimes(1);

    readFileMock.mockResolvedValueOnce('## Heading\nAnother update');
    await watcher.emit('change', RULE_PATH);
    await jest.advanceTimersByTimeAsync(400);
    expect(notify).not.toHaveBeenCalled();
  });
});
