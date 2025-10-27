import { collectDocumentAnalytics, DOCUMENT_GATE_ORDER } from '../document-analytics';
import type { QualityGateResults } from '../quality-gates';

describe('collectDocumentAnalytics', () => {
  it('aggregates violations across DOC-01〜DOC-08 and maps impacted tasks', () => {
    const results: QualityGateResults = {
      'DOC-01': [
        { path: 'docs/QA/Q1.mdc', message: 'Missing breadcrumbs', severity: 'error' }
      ],
      'DOC-02': [],
      'DOC-03': [],
      'DOC-04': [
        { path: 'docs/PRD/Feature.mdc', message: 'Cycle detected', severity: 'warn' }
      ],
      'DOC-05': [
        { path: 'docs/ARCH/Design.mdc', heading: '2. UI', message: 'Missing numbering', severity: 'error' }
      ],
      'DOC-06': [
        { path: 'docs/PRD/Feature.mdc', link: 'overview', message: 'TOC link missing', severity: 'error' }
      ],
      'DOC-07': [
        { path: 'docs/DATA/BadName.txt', message: 'Invalid extension', severity: 'error' }
      ],
      'DOC-08': [
        { path: 'docs/QA/Q1.mdc', message: 'Scope missing', severity: 'warn' }
      ]
    };

    const docStatus = {
      'docs/QA/Q1.mdc': { status: 'missing-breadcrumbs' },
      'docs/PRD/Feature.mdc': { status: 'ok' },
      'docs/ARCH/Design.mdc': { status: 'ok' },
      'docs/DATA/BadName.txt': { status: 'ok' }
    };

    const tasks = [
      { id: 'T-1', status: 'TODO', links: { PRD: 'docs/PRD/Feature.mdc' } },
      { id: 'T-2', status: 'IN_PROGRESS', links: { QA: 'docs/QA/Q1.mdc', DATA: 'docs/DATA/BadName.txt' } },
      { id: 'T-3', status: 'DONE', links: { ARCH: 'docs/ARCH/Design.mdc' } }
    ];

    const analytics = collectDocumentAnalytics({ results, docStatus, tasks });

    expect(analytics.documents.total).toBe(4);
    expect(analytics.documents.withViolations).toBe(4);
    expect(analytics.documents.byStatus).toMatchObject({
      ok: 3,
      'missing-breadcrumbs': 1
    });

    expect(analytics.tasks.total).toBe(3);
    expect(analytics.tasks.byStatus).toMatchObject({
      TODO: 1,
      IN_PROGRESS: 1,
      DONE: 1
    });

    // Ensure every gate is represented in the expected order
    expect(analytics.gates.map(g => g.gateId)).toEqual(Array.from(DOCUMENT_GATE_ORDER));

    const gate01 = analytics.gates.find(g => g.gateId === 'DOC-01');
    expect(gate01).toMatchObject({
      totalViolations: 1,
      uniqueDocuments: 1,
      severity: { error: 1, warn: 0, info: 0 },
      impactedTasks: 1
    });

    const gate04 = analytics.gates.find(g => g.gateId === 'DOC-04');
    expect(gate04).toMatchObject({
      severity: { error: 0, warn: 1, info: 0 },
      impactedTasks: 1
    });

    const gate05 = analytics.gates.find(g => g.gateId === 'DOC-05');
    expect(gate05).toMatchObject({
      totalViolations: 1,
      uniqueDocuments: 1,
      impactedTasks: 1
    });

    const gate08 = analytics.gates.find(g => g.gateId === 'DOC-08');
    expect(gate08).toMatchObject({
      totalViolations: 1,
      severity: { error: 0, warn: 1, info: 0 },
      impactedTasks: 1
    });
  });
});
