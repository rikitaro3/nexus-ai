import { cp, mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/validate-docs-gates/project');
const RULES_SOURCE = path.resolve(__dirname, '../../docs/GATES');

export interface TempProject {
  projectRoot: string;
  cleanup: () => Promise<void>;
}

export async function createTempProjectFixture(): Promise<TempProject> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-integration-'));
  await cp(FIXTURE_ROOT, tempDir, { recursive: true });

  const rulesDest = path.join(tempDir, 'docs', 'GATES');
  await mkdir(rulesDest, { recursive: true });
  await cp(RULES_SOURCE, rulesDest, { recursive: true });

  const contextPath = path.join(tempDir, 'context.mdc');
  try {
    const original = await readFile(contextPath, 'utf8');
    const sanitized = original.replace(/###\s+/g, '###\t');
    if (sanitized !== original) {
      await writeFile(contextPath, sanitized, 'utf8');
    }
  } catch {
    // ignore if context file is missing in the fixture
  }

  return {
    projectRoot: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  { timeout = 5000, interval = 50 }: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) {
      return;
    }
    await delay(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
