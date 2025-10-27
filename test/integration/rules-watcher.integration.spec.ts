import { appendFile } from 'fs/promises';
import path from 'path';
import { createRulesWatcher, RulesWatcherEvent } from '../../src/main/watchers/rules-watcher';
import { createTempProjectFixture, waitForCondition } from '../utils/test-project';
import { runQualityGatesValidation } from '../../src/main/utils/quality-gates';

jest.mock('../../src/main/utils/quality-gates', () => {
  const path = require('path');
  const actual = jest.requireActual('../../src/main/utils/quality-gates');

  function buildResult(mode: 'auto' | 'manual' | 'bulk', contextPath?: string | null) {
    const payload = {
      results: {
        'DOC-01': [
          { severity: 'error', message: 'Heading missing' },
          { severity: 'warn', message: 'Update breadcrumbs' }
        ],
        'DOC-04': [{ severity: 'info', message: 'Informational note' }]
      },
      contextPath: contextPath ?? null,
      docStatus: null
    };

    return {
      timestamp: new Date().toISOString(),
      mode,
      exitCode: 0,
      payload,
      summary: actual.summarizeGateResults(payload.results),
      diff: null,
      autofix: null,
      repoDiff: null,
      logPath: path.join('logs', 'quality-gates', `integration-${mode}.json`),
      relativeLogPath: path.join('logs/quality-gates', `integration-${mode}.json`),
      rawOutput: '',
      stderr: ''
    };
  }

  return {
    __esModule: true,
    ...actual,
    runQualityGatesValidation: jest.fn(async (_root: string, options?: { mode?: 'auto' | 'manual' | 'bulk'; contextPath?: string | null }) =>
      buildResult(options?.mode ?? 'auto', options?.contextPath ?? null)
    ),
    runQualityGatesAutofix: jest.fn(async (_root: string, options?: { contextPath?: string | null }) =>
      buildResult('bulk', options?.contextPath ?? null)
    ),
    listQualityGateLogs: jest.fn(async () => []),
    loadLatestQualityGateLog: jest.fn(async () => null)
  };
});

describe('RulesWatcherController integration', () => {
  jest.setTimeout(20000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits a diff summary and validation snapshot when rules change', async () => {
    const { projectRoot, cleanup } = await createTempProjectFixture();
    const notifications: RulesWatcherEvent[] = [];

    const controller = createRulesWatcher({
      projectRoot,
      notify: event => {
        notifications.push(event);
      }
    });

    try {
      const rulePath = path.join(projectRoot, 'docs', 'GATES', 'document.mdc');

      await appendFile(
        rulePath,
        '\n\n### Integration Added Heading\nDetailed explanation for integration testing.\n'
      );

      await (controller as any).handleRuleFileEvent('change', rulePath);

      await waitForCondition(() => notifications.length > 0, { timeout: 8000, interval: 100 });

      const event = notifications[notifications.length - 1];
      expect(event.rulesDiff).not.toBeNull();
      expect(event.rulesDiff?.files[0]).toMatchObject({
        path: path.relative(projectRoot, rulePath),
        event: 'change'
      });
      expect(event.rulesDiff?.files[0].addedHeadings).toContain('Integration Added Heading');
      expect(event.pipeline.lastRun).not.toBeNull();
      expect(event.pipeline.lastRun?.summary[0]).toMatchObject({ gateId: 'DOC-01', total: 2 });
      expect((runQualityGatesValidation as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    } finally {
      controller.dispose();
      await cleanup();
    }
  });
});
