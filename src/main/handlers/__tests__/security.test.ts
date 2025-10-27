import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import { withPathValidation, validatePath } from '../security';
import { ErrorType } from '../../utils/error-handler';

describe('security path validation', () => {
  let tempDir: string;
  const originalEnv = process.env;
  const fakeEvent = {} as unknown as IpcMainInvokeEvent;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-security-'));
    fs.mkdirSync(path.join(tempDir, 'docs'));
    fs.writeFileSync(path.join(tempDir, 'docs', 'sample.mdc'), '# sample');
    process.env.NEXUS_PROJECT_ROOT = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it('accepts a valid relative path inside the repository', () => {
    const result = validatePath('docs/sample.mdc');

    expect(result.valid).toBe(true);
    expect(result.target).toBe(path.join(tempDir, 'docs', 'sample.mdc'));
  });

  it('rejects traversal attempts', () => {
    const result = validatePath('../etc/passwd');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('ディレクトリトラバーサル');
  });

  it('rejects paths outside the repository', () => {
    const outsideFile = path.join(os.tmpdir(), 'other.txt');
    fs.writeFileSync(outsideFile, 'data');

    const result = validatePath(outsideFile);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('パスがリポジトリ外');
    fs.rmSync(outsideFile, { force: true });
  });

  it('wraps handler and throws AppError when validation fails', async () => {
    const handler = jest.fn();
    const wrapped = withPathValidation(handler);

    await expect(wrapped(fakeEvent, 'missing/file.txt')).rejects.toMatchObject({
      type: ErrorType.SECURITY_ERROR
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('invokes wrapped handler when validation succeeds', async () => {
    const handler = jest.fn(async () => 'ok');
    const wrapped = withPathValidation(handler);

    await expect(wrapped(fakeEvent, 'docs/sample.mdc')).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
    const callArgs = handler.mock.calls[0] as unknown[];
    expect(callArgs.length).toBeGreaterThanOrEqual(2);
    const validation = callArgs[1] as ReturnType<typeof validatePath>;
    expect(validation).toMatchObject({ valid: true });
  });
});
