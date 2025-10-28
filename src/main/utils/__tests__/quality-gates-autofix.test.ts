import path from 'path';
import os from 'os';
import fs from 'fs/promises';

import {
  applyDocsGatesAutofix
} from '../../../../scripts/apply-docs-gates';
import {
  createEmptyGateResults,
  parseAllBreadcrumbs,
  parseContextEntries,
  validateDocumentGates
} from '../../../../scripts/validate-docs-gates';

describe('apply-docs-gates autofix', () => {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'docs-autofix');
  let tempDir: string;

  async function copyDir(src: string, dest: string) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  beforeEach(async () => {
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-autofix-'));
    tempDir = tmpBase;
    await copyDir(fixtureRoot, tempDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs document gates issues and renames files to match naming rules', async () => {
    const contextPath = path.join(tempDir, 'context.mdc');

    const summary = await applyDocsGatesAutofix({
      projectRoot: tempDir,
      contextPath
    });

    expect(summary.status).toBe('ok');
    expect(Array.isArray(summary.operations)).toBe(true);

    const renameOperation = summary.operations.find(op => op.type === 'rename');
    expect(renameOperation).toBeDefined();
    expect(renameOperation?.from).toBe('docs/QA/qa_sample.mdc');
    expect(renameOperation?.to).toMatch(/^docs\/QA\/[A-Z0-9_]+\.mdc$/);

    const renamedPath = renameOperation?.to as string;
    const updatedContext = await fs.readFile(contextPath, 'utf8');
    expect(updatedContext).toContain(renamedPath);
    expect(summary.files).toContain(renamedPath);
    const touchedContext = summary.operations.some(op => op.type === 'modify' && op.path === 'context.mdc');
    if (touchedContext) {
      expect(summary.files).toContain('context.mdc');
    }

    const updatedDoc = await fs.readFile(path.join(tempDir, renamedPath), 'utf8');
    expect(updatedDoc).toContain('> Breadcrumbs');
    expect(updatedDoc).toMatch(/##\s+目次/);
    expect(updatedDoc).toMatch(/##\s+1\.\s+扱う内容/);
    expect(updatedDoc).toMatch(/##\s+2\.\s+扱わない内容/);
    expect(updatedDoc).toMatch(/##\s+3\.\s+Purpose/);
    expect(updatedDoc).toMatch(/##\s+4\.\s+Details/);

    const entries = parseContextEntries(updatedContext);
    const { nodes, docStatus, docRecords } = await parseAllBreadcrumbs(entries, tempDir);
    const results = createEmptyGateResults();
    validateDocumentGates(nodes, docStatus, docRecords, results);

    for (const gateId of ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08']) {
      const violations = results[gateId] || [];
      expect(violations).toEqual([]);
    }
  });
});
