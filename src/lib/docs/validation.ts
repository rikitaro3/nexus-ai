import matter from 'gray-matter';
import type { RawFrontmatter } from './metadata';

export interface DocumentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_LAYERS = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'] as const;

export function collectValidationIssues(frontmatter: RawFrontmatter, body: string): Pick<DocumentValidationResult, 'errors' | 'warnings'> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = typeof frontmatter.title === 'string' ? frontmatter.title : null;
  const layer = typeof frontmatter.layer === 'string' ? frontmatter.layer : null;

  if (!title) {
    errors.push('フロントマターにtitleが必要です');
  }

  if (!layer) {
    errors.push('フロントマターにlayerが必要です');
  }

  if (layer && !VALID_LAYERS.includes(layer as typeof VALID_LAYERS[number])) {
    errors.push(`無効なレイヤー: ${layer}`);
  }

  if (!body.includes('> Breadcrumbs')) {
    warnings.push('Breadcrumbsセクションがありません');
  }

  if (frontmatter.upstream !== undefined && !Array.isArray(frontmatter.upstream) && typeof frontmatter.upstream !== 'string') {
    warnings.push('upstreamは配列または文字列である必要があります');
  }

  if (frontmatter.downstream !== undefined && !Array.isArray(frontmatter.downstream) && typeof frontmatter.downstream !== 'string') {
    warnings.push('downstreamは配列または文字列である必要があります');
  }

  return { errors, warnings };
}

export function validateDocument(content: string): DocumentValidationResult {
  try {
    const { data, content: body } = matter<RawFrontmatter>(content);
    const { errors, warnings } = collectValidationIssues(data, body);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch {
    return {
      valid: false,
      errors: ['YAMLフロントマターの構文エラー'],
      warnings: [],
    };
  }
}
