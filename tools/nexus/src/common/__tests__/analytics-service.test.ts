import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectAnalytics } from '../analytics-service';

function writeFileSync(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

describe('collectAnalytics', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-analytics-'));
    const context = `# Dummy\n\n## Context Map\n\n### PRD\n- docs/PRD/valid.mdc … Valid doc\n\n### QA\n- docs/QA/bad.txt … Invalid naming\n`;
    writeFileSync(path.join(tmpDir, 'tools', 'nexus', 'context.mdc'), context);

    const validDoc = `# Valid Doc\n> Breadcrumbs\n> Layer: PRD\n> Upstream: N/A\n> Downstream: docs/QA/bad.txt\n\n## 目次\n- [1. Overview](#1-overview)\n- [2. Details](#2-details)\n\n## 扱う内容\n- 概要を説明する\n\n## 扱わない内容\n- 特になし\n\n## Scope\n- PRDのみ\n\n## 1. Overview\n内容\n\n## 2. Details\n詳細\n`;
    writeFileSync(path.join(tmpDir, 'docs', 'PRD', 'valid.mdc'), validDoc);

    const invalidDoc = `# Invalid Doc\n> Breadcrumbs\n> Layer: QA\n> Upstream: docs/PRD/valid.mdc\n> Downstream: N/A\n\n## 目次\n- [1. Setup](#1-setup)\n- [3. Broken](#3-broken)\n- [Missing](#missing-anchor)\n\n## Scope\nTODO\n\n## 1. Setup\nstart\n\n## 3. Broken\nskip number\n`;
    writeFileSync(path.join(tmpDir, 'docs', 'QA', 'bad.txt'), invalidDoc);

    const tasks = [
      { status: 'TODO', priority: 'HIGH' },
      { status: 'DONE', priority: 'LOW' }
    ];
    writeFileSync(path.join(tmpDir, 'tools', 'nexus', 'tasks.json'), JSON.stringify(tasks));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes metrics including extended gate checks', async () => {
    const metrics = await collectAnalytics({ projectRoot: tmpDir, persistHistory: false });

    expect(metrics.context.entries).toBe(2);
    expect(metrics.tasks.total).toBe(2);
    expect(metrics.tasks.statusCounts.DONE).toBe(1);
    expect(metrics.qualityGates.gates['DOC-05'].violationCount).toBeGreaterThanOrEqual(1);
    expect(metrics.qualityGates.gates['DOC-06'].violationCount).toBeGreaterThanOrEqual(1);
    expect(metrics.qualityGates.gates['DOC-07'].violationCount).toBeGreaterThanOrEqual(1);
    expect(metrics.qualityGates.gates['DOC-08'].violationCount).toBeGreaterThanOrEqual(1);
    expect(metrics.qualityGates.history).toHaveLength(1);
    const latest = metrics.qualityGates.history[0];
    expect(latest.violationTotals['DOC-05']).toBeGreaterThanOrEqual(1);
    expect(latest.violationTotals['DOC-06']).toBeGreaterThanOrEqual(1);
  });
});

