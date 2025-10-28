import path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import { createRulesWatcher, RulesWatcherEvent } from '../../src/main/watchers/rules-watcher';
import { withPathValidation } from '../../src/main/handlers/security';
import { createTempProjectFixture } from '../utils/test-project';
import { AppError, ErrorType } from '../../src/main/utils/error-handler';

jest.mock('../../src/main/utils/quality-gates', () => {
  const path = require('path');
  const actual = jest.requireActual('../../src/main/utils/quality-gates');

  function buildResult(mode: 'auto' | 'manual' | 'bulk', contextPath?: string | null) {
    const payload = {
      results: {
        'DOC-01': [{ severity: 'warn', message: 'Warn only' }]
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
      logPath: path.join('logs', 'quality-gates', `security-${mode}.json`),
      relativeLogPath: path.join('logs/quality-gates', `security-${mode}.json`),
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

describe('withPathValidation integration', () => {
  jest.setTimeout(15000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to RulesWatcherController for valid paths and rejects traversal attempts', async () => {
    const { projectRoot, cleanup } = await createTempProjectFixture();
    process.env.NEXUS_PROJECT_ROOT = projectRoot;
    const notifications: RulesWatcherEvent[] = [];

    const controller = createRulesWatcher({
      projectRoot,
      notify: event => {
        notifications.push(event);
      }
    });

    const handler = withPathValidation(async (_event: IpcMainInvokeEvent, validation) => {
      return controller.setContextPath(validation.target);
    });

    try {
      const contextRelative = path.relative(projectRoot, path.join(projectRoot, 'context.mdc'));
      const event = await handler({} as IpcMainInvokeEvent, contextRelative);

      expect(event.message).toContain('context:set');
      expect(event.impact.contextPath).toBe('context.mdc');
      expect(notifications[notifications.length - 1]).toEqual(event);

      await expect(handler({} as IpcMainInvokeEvent, '../outside.mdc')).rejects.toMatchObject({
        type: ErrorType.SECURITY_ERROR
      } satisfies Partial<AppError>);
    } finally {
      controller.dispose();
      delete process.env.NEXUS_PROJECT_ROOT;
      await cleanup();
    }
  });
});
