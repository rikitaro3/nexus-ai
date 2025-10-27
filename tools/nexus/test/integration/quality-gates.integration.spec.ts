import { createTempProjectFixture } from '../utils/test-project';
import { scanQualityGateImpacts } from '../../src/main/utils/document-impact';
import { summarizeGateResults } from '../../src/main/utils/quality-gates';

describe('Quality gate utilities integration', () => {
  jest.setTimeout(10000);

  it('computes impact summary from context map and aggregates gate results', async () => {
    const { projectRoot, cleanup } = await createTempProjectFixture();

    try {
      const impact = await scanQualityGateImpacts(projectRoot);

      expect(impact.projectRoot).toBe(projectRoot);
      expect(impact.documents).toHaveLength(7);
      expect(impact.summary.total).toBe(7);
      expect(impact.summary.missing).toBe(0);
      expect(impact.summary.categories).toMatchObject({
        Strategy: 2,
        Architecture: 1,
        'Product Requirements': 1,
        'Quality Assurance': 3
      });
      expect(impact.contextPath).toBe('context.mdc');

      const results = {
        'DOC-01': [
          { severity: 'error' as const },
          { severity: 'warn' as const }
        ],
        'DOC-03': [{ severity: 'info' as const }]
      };

      const summary = summarizeGateResults(results);
      const doc01 = summary.find(item => item.gateId === 'DOC-01');
      expect(doc01).toMatchObject({ total: 2, severity: { error: 1, warn: 1, info: 0 } });
      const doc03 = summary.find(item => item.gateId === 'DOC-03');
      expect(doc03).toMatchObject({ total: 1, severity: { error: 0, warn: 0, info: 1 } });
    } finally {
      await cleanup();
    }
  });
});
