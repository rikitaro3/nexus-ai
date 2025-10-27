import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('security helpers', () => {
  const originalEnv = process.env.NEXUS_PROJECT_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXUS_PROJECT_ROOT;
    } else {
      process.env.NEXUS_PROJECT_ROOT = originalEnv;
    }
  });

  function loadSecurityModule() {
    jest.resetModules();
    return require('../security') as typeof import('../security');
  }

  describe('getRepoRoot', () => {
    it('prefers the environment variable when present', () => {
      process.env.NEXUS_PROJECT_ROOT = '/tmp/from-env';
      const { getRepoRoot } = loadSecurityModule();
      expect(getRepoRoot()).toBe('/tmp/from-env');
    });

    it('falls back to a custom project root when configured', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-'));
      delete process.env.NEXUS_PROJECT_ROOT;
      const { getRepoRoot, setCustomProjectRoot } = loadSecurityModule();
      setCustomProjectRoot(tempDir);
      expect(getRepoRoot()).toBe(tempDir);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('uses the global project root when nothing else is configured', () => {
      delete process.env.NEXUS_PROJECT_ROOT;
      const { getRepoRoot, setGlobalProjectRoot } = loadSecurityModule();
      setGlobalProjectRoot('/tmp/global-root');
      expect(getRepoRoot()).toBe('/tmp/global-root');
    });
  });

  describe('validatePath', () => {
    let tempDir: string;
    let insideFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-'));
      insideFile = path.join(tempDir, 'docs', 'readme.md');
      fs.mkdirSync(path.dirname(insideFile), { recursive: true });
      fs.writeFileSync(insideFile, '# test');
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('accepts a relative path inside the repository', () => {
      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { validatePath } = loadSecurityModule();
      const relative = path.relative(tempDir, insideFile);

      const result = validatePath(relative);

      expect(result.valid).toBe(true);
      expect(result.target).toBe(path.resolve(insideFile));
      expect(result.repoRoot).toBe(path.resolve(tempDir));
      expect(result.isInsideRepo).toBe(true);
      expect(result.allowedByWhitelist).toBe(false);
    });

    it('rejects directory traversal attempts', () => {
      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { validatePath } = loadSecurityModule();

      const result = validatePath('../secret.txt');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('ディレクトリトラバーサル攻撃を検出');
    });

    it('rejects absolute paths outside the repository', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      const outsideFile = path.join(outside, 'data.txt');
      fs.writeFileSync(outsideFile, 'data');

      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { validatePath } = loadSecurityModule();

      const result = validatePath(outsideFile);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('パスがリポジトリ外');
      expect(result.allowedByWhitelist).toBeUndefined();

      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('allows whitelisted absolute paths outside the repository', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      const outsideFile = path.join(outside, 'context.mdc');
      fs.writeFileSync(outsideFile, '# context');

      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { validatePath } = loadSecurityModule();

      const result = validatePath(outsideFile);

      expect(result.valid).toBe(true);
      expect(result.target).toBe(path.resolve(outsideFile));
      expect(result.allowedByWhitelist).toBe(true);
      expect(result.isInsideRepo).toBe(false);

      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('fails validation when the file does not exist', () => {
      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { validatePath } = loadSecurityModule();

      const result = validatePath('docs/missing.md');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('File does not exist');
    });
  });

  describe('withPathValidation', () => {
    let tempDir: string;
    let insideFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-'));
      insideFile = path.join(tempDir, 'docs', 'guide.md');
      fs.mkdirSync(path.dirname(insideFile), { recursive: true });
      fs.writeFileSync(insideFile, 'content');
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('passes the validation result to the wrapped handler', async () => {
      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { withPathValidation } = loadSecurityModule();
      const handler = jest.fn(async (_event, validation) => validation.target);
      const wrapped = withPathValidation(handler);

      const result = await wrapped({} as any, path.relative(tempDir, insideFile));

      expect(result).toBe(path.resolve(insideFile));
      expect(handler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ valid: true, allowedByWhitelist: false, isInsideRepo: true })
      );
    });

    it('throws a security error when validation fails', async () => {
      process.env.NEXUS_PROJECT_ROOT = tempDir;
      const { withPathValidation } = loadSecurityModule();
      const wrapped = withPathValidation(async () => 'ok');

      await expect(wrapped({} as any, 'docs/missing.md')).rejects.toMatchObject({
        type: 'SecurityError',
        message: 'File does not exist'
      });
    });
  });
});
