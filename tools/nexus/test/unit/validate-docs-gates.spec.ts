import fs from 'fs/promises';
import path from 'path';
import {
    createEmptyGateResults,
    parseAllBreadcrumbs,
    parseContextEntries,
    validateDocumentGates,
    validateTestCaseGates
} from '../../scripts/validate-docs-gates';

describe('validate-docs-gates quality checks', () => {
  const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'validate-docs-gates', 'project');

  it('detects DOC-01 through DOC-08 violations from fixture documents', async () => {
    const contextText = await fs.readFile(path.join(fixtureRoot, 'context.yaml'), 'utf8');
    const entries = parseContextEntries(contextText);
    const { nodes, docStatus, docContents } = await parseAllBreadcrumbs(entries, fixtureRoot);
    const results = createEmptyGateResults();

    validateDocumentGates(nodes, docStatus, docContents, results);

    expect(results['DOC-01']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/STRATEGY/STRATEGY_NoBreadcrumbs.mdc' })
      ])
    );
    expect(results['DOC-02']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/ARCH/ARCH_BadLayer.mdc', layer: 'UNKNOWN' })
      ])
    );
    expect(results['DOC-03']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/PRD/PRD_BadStructure.mdc', link: 'docs/STRATEGY/DOES_NOT_EXIST.mdc' }),
        expect.objectContaining({ path: 'docs/PRD/PRD_BadStructure.mdc', link: 'docs/QA/DOES_NOT_EXIST.mdc' })
      ])
    );
    expect(results['DOC-04']).not.toHaveLength(0);
    expect(results['DOC-04'][0].cycle).toEqual(
      expect.arrayContaining([
        'docs/QA/QA_CYCLE_A.mdc',
        'docs/QA/QA_CYCLE_B.mdc'
      ])
    );
    expect(results['DOC-05']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/PRD/PRD_BadStructure.mdc' })
      ])
    );
    expect(results['DOC-06']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/PRD/PRD_BadStructure.mdc', link: '1-overview' })
      ])
    );
    expect(results['DOC-07']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/QA/qa-bad-name.mdc' })
      ])
    );
    expect(results['DOC-08']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/PRD/PRD_BadStructure.mdc', severity: 'warn' })
      ])
    );
  });

  it('detects TC-01 through TC-04 violations from fixture tests', async () => {
    const results = createEmptyGateResults();
    await validateTestCaseGates(fixtureRoot, results, { testRoots: ['tests'] });

    expect(results['TC-01']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tests/unit/badcase.spec.ts', severity: 'error' })
      ])
    );
    expect(results['TC-02']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tests/unit/docs-navigator-dependent-flow.spec.ts', severity: 'warn' })
      ])
    );
    expect(results['TC-03']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tests/integration/tasks-undocumented-run.spec.ts', severity: 'warn' })
      ])
    );
    expect(results['TC-04']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tests/integration/tree-view-fixture-usage.spec.ts', severity: 'error' })
      ])
    );
  });
});
