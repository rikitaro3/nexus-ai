import path from 'path';

import { PathGuardError, assertWithinRepo, resolveDocPath } from '../pathGuard';

describe('assertWithinRepo', () => {
  it('allows paths inside the repo', () => {
    const root = '/repo/docs';
    const target = path.join(root, 'file.mdc');
    expect(() => assertWithinRepo(target, root)).not.toThrow();
  });

  it('throws when path escapes the repo', () => {
    const root = '/repo/docs';
    const target = '/repo/../secret/file.mdc';
    expect(() => assertWithinRepo(target, root)).toThrow(PathGuardError);
  });
});

describe('resolveDocPath', () => {
  let cwdSpy: jest.SpiedFunction<typeof process.cwd>;

  beforeEach(() => {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/repo');
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  it('normalizes relative paths and prefixes docs/', () => {
    const result = resolveDocPath('guides/setup.mdc');
    expect(result.relative).toBe('docs/guides/setup.mdc');
    expect(result.absolute).toBe(path.resolve('/repo', 'docs/guides/setup.mdc'));
  });

  it('accepts paths already under docs/', () => {
    const result = resolveDocPath('docs/readme.mdc');
    expect(result.relative).toBe('docs/readme.mdc');
  });

  it('rejects traversal attempts', () => {
    expect(() => resolveDocPath('../secrets.mdc')).toThrow(PathGuardError);
  });

  it('rejects absolute paths', () => {
    expect(() => resolveDocPath('/etc/passwd')).toThrow(PathGuardError);
  });
});
