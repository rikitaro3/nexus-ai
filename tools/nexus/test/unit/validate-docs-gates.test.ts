import fs from 'fs/promises';
import path from 'path';

type GateViolation = { path?: string; severity?: string; [key: string]: unknown };
type GateResults = Record<string, GateViolation[]>;

type ValidationResult = {
  results: GateResults;
};

const qualityGates = require('../../scripts/validate-docs-gates.js');

const ALL_GATES = [
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
];

describe('validate-docs-gates integration', () => {
  const fixturesRoot = path.resolve(__dirname, '..', 'fixtures', 'quality-gates');

  async function loadQualityGateResults(fixtureName: string): Promise<ValidationResult> {
    const projectRoot = path.join(fixturesRoot, fixtureName);
    const contextPath = path.join(projectRoot, 'context.mdc');
    const contextText = await fs.readFile(contextPath, 'utf8');

    const entries = qualityGates.parseContextEntries(contextText);
    const { nodes, docStatus, docContents } = await qualityGates.parseAllBreadcrumbs(entries, projectRoot);
    const docResults: GateResults = qualityGates.validateGates(nodes, docStatus, docContents);

    const { testFiles, fixtureFiles } = await qualityGates.loadTestCaseFiles(projectRoot, ['test-cases']);
    const tcResults: GateResults = qualityGates.validateTestCaseGates(testFiles, fixtureFiles);

    const combined: GateResults = { ...docResults, ...tcResults };
    for (const gateId of ALL_GATES) {
      combined[gateId] = combined[gateId] ?? [];
    }

    return { results: combined };
  }

  function extractPaths(results: GateResults, gateId: string): string[] {
    return (results[gateId] || []).map(violation => violation.path ?? '').sort();
  }

  function expectGateResults(results: GateResults, gateId: string, expected: string[]) {
    expect(extractPaths(results, gateId)).toEqual([...expected].sort());
  }

  test('passes all gates for the passing fixture set', async () => {
    const { results } = await loadQualityGateResults('pass');
    for (const gateId of ALL_GATES) {
      expect(results[gateId]).toHaveLength(0);
    }
  });

  test('detects violations for all DOC and TC gates in the failing fixture set', async () => {
    const { results } = await loadQualityGateResults('fail');

    expectGateResults(results, 'DOC-01', ['docs/ARCH/MISSING_BREADCRUMBS.mdc']);
    expectGateResults(results, 'DOC-02', ['docs/ARCH/INVALID_LAYER_DOC.mdc']);
    expectGateResults(results, 'DOC-03', ['docs/ARCH/MISSING_LINK_DOC.mdc']);
    expectGateResults(results, 'DOC-04', ['docs/ARCH/CYCLE_A_DOC.mdc']);
    expectGateResults(results, 'DOC-05', ['docs/ARCH/BAD_HEADING_DOC.mdc']);
    expectGateResults(results, 'DOC-06', ['docs/ARCH/MISSING_TOC_DOC.mdc']);
    expectGateResults(results, 'DOC-07', ['docs/ARCH/lowercase-name.mdc']);
    expectGateResults(results, 'DOC-08', ['docs/ARCH/MISSING_SCOPE_DOC.mdc']);

    expectGateResults(results, 'TC-01', ['test-cases/fail/InvalidNameCase.spec.ts']);
    expectGateResults(results, 'TC-02', ['test-cases/fail/docs-navigator-dependent.spec.ts']);
    expectGateResults(results, 'TC-03', ['test-cases/fail/docs-navigator-undocumented.spec.ts']);
    expectGateResults(results, 'TC-04', ['test-cases/fail/docs-navigator-data-missing.spec.ts']);
  });
});
