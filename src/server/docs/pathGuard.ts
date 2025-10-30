import path from 'path';

export class PathGuardError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'PATH_GUARD_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ResolvedDocPath {
  repoRoot: string;
  docsRoot: string;
  relative: string;
  absolute: string;
}

export function assertWithinRepo(targetPath: string, allowedRoot: string): void {
  const relative = path.relative(allowedRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathGuardError('docsディレクトリ外へのアクセスは許可されていません', 403, 'PATH_OUT_OF_SCOPE');
  }
}

function sanitizeInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new PathGuardError('Path parameter is required', 400, 'PATH_REQUIRED');
  }

  if (trimmed.startsWith('/') || trimmed.includes('\0')) {
    throw new PathGuardError('絶対パスおよび制御文字は使用できません', 400, 'PATH_INVALID');
  }

  return trimmed.replace(/\\/g, '/');
}

export function resolveDocPath(requestPath: string): ResolvedDocPath {
  if (typeof requestPath !== 'string') {
    throw new PathGuardError('Path parameter is required', 400, 'PATH_REQUIRED');
  }

  const repoRoot = process.cwd();
  const docsRoot = path.resolve(repoRoot, 'docs');

  const sanitized = sanitizeInput(requestPath);
  const normalized = path.posix.normalize(sanitized);

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new PathGuardError('ディレクトリトラバーサルが検出されました', 400, 'PATH_TRAVERSAL');
  }

  const relative = normalized.startsWith('docs/') ? normalized : `docs/${normalized}`;
  const absolute = path.resolve(repoRoot, relative);

  assertWithinRepo(absolute, docsRoot);

  return {
    repoRoot,
    docsRoot,
    relative,
    absolute,
  };
}
