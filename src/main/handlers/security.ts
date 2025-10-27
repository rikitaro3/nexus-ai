import { IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createSecurityError } from '../utils/error-handler';
import { logger } from '../utils/logger';

export interface PathValidationResult {
  valid: boolean;
  repoRoot: string;
  normalized: string;
  target: string;
  error?: string;
}

export interface SecurityConfig {
  allowPaths: string[];
  denyPaths: string[];
  maxPathLength: number;
}

/**
 * リポジトリのルートディレクトリを解決する
 */
// カスタムプロジェクトルート（設定画面から設定可能）
let customProjectRoot: string | null = null;

export function setCustomProjectRoot(root: string): void {
  customProjectRoot = root;
}

let globalProjectRoot: string | null = null;

export function setGlobalProjectRoot(root: string): void {
  globalProjectRoot = root;
  logger.info('Global project root set', { root });
}

export function getRepoRoot(): string {
  // 優先順位1: 環境変数（テストや明示的指定用）
  if (process.env.NEXUS_PROJECT_ROOT) {
    logger.info('Using NEXUS_PROJECT_ROOT from env', { root: process.env.NEXUS_PROJECT_ROOT });
    return process.env.NEXUS_PROJECT_ROOT;
  }
  
  // 優先順位2: カスタム設定（Settings画面から）
  if (customProjectRoot && fs.existsSync(customProjectRoot)) {
    logger.info('Using custom project root', { root: customProjectRoot });
    return customProjectRoot;
  }
  
  // 優先順位3: グローバル設定（main.tsから渡される）
  if (globalProjectRoot) {
    logger.info('Using global project root', { root: globalProjectRoot });
    return globalProjectRoot;
  }
  
  // 優先順位4: フォールバック（エラー）
  const fallback = path.resolve(__dirname, '../../../../../..');
  logger.error('Project root not set, using fallback', { fallback });
  return fallback;
}

/**
 * 相対パスを検証し、リポジトリ外アクセスを防止する
 */
export function validatePath(relPath: string): PathValidationResult {
  try {
    const repoRoot = getRepoRoot();
    const resolvedRepoRoot = path.resolve(repoRoot);

    // 絶対パスの場合はそのまま使用（ファイル選択のケース）
    let target: string;
    let normalized = relPath;
    if (path.isAbsolute(relPath)) {
      target = path.resolve(relPath);
      normalized = path.normalize(relPath);
      logger.info('Using absolute path', { relPath, target });
    } else {
      // 相対パスの場合は検証付きで解決
      normalized = path.normalize(relPath);
      target = path.resolve(resolvedRepoRoot, normalized);
      logger.info('Path validation', {
        relPath,
        repoRoot: resolvedRepoRoot,
        normalized,
        target,
        'repoRoot_basename': path.basename(resolvedRepoRoot),
        'target_basename': path.basename(target)
      });

      // ディレクトリトラバーサル攻撃の防止
      if (normalized.includes('..')) {
        logger.warn('ディレクトリトラバーサル攻撃を検出', { relPath, normalized });
        return {
          valid: false,
          repoRoot,
          normalized,
          target,
          error: 'ディレクトリトラバーサル攻撃を検出'
        };
      }
      
    }

    const resolvedTarget = path.resolve(target);
    const relativeToRepo = path.relative(resolvedRepoRoot, resolvedTarget);

    if (path.isAbsolute(relativeToRepo) || relativeToRepo.startsWith('..')) {
      logger.warn('パスがリポジトリ外', {
        relPath,
        normalized,
        target: resolvedTarget,
        repoRoot: resolvedRepoRoot,
        relativeToRepo
      });
      return {
        valid: false,
        repoRoot: resolvedRepoRoot,
        normalized,
        target: resolvedTarget,
        error: 'パスがリポジトリ外'
      };
    }

    // ファイルの存在確認
    if (!fs.existsSync(resolvedTarget)) {
      logger.warn('File does not exist', { target: resolvedTarget });
      return {
        valid: false,
        repoRoot: resolvedRepoRoot,
        normalized,
        target: resolvedTarget,
        error: 'File does not exist'
      };
    }

    return {
      valid: true,
      repoRoot: resolvedRepoRoot,
      normalized,
      target: resolvedTarget
    };
  } catch (e) {
    logger.error('パス検証中にエラーが発生', { relPath, error: (e as Error).message });
    return {
      valid: false,
      repoRoot: '',
      normalized: '',
      target: '',
      error: (e as Error).message
    };
  }
}

/**
 * IPCハンドラーにパス検証を追加するラッパー関数
 */
export function withPathValidation<T>(
  handler: (event: IpcMainInvokeEvent, validation: PathValidationResult) => Promise<T>
) {
  return async (event: IpcMainInvokeEvent, relPath: string): Promise<T> => {
    const validation = validatePath(relPath);
    
    if (!validation.valid) {
      logger.error('パス検証失敗', validation);
      throw createSecurityError(validation.error || 'パス検証失敗', validation);
    }
    
    return handler(event, validation);
  };
}

