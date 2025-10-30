import matter from 'gray-matter';

export type RawFrontmatter = Record<string, unknown>;

export interface DocumentMetadata {
  path: string;
  title: string;
  layer: string;
  upstream: string[];
  downstream: string[];
}

export function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '' && entry !== 'N/A');
  }

  if (typeof value === 'string') {
    if (value.trim() === '' || value === 'N/A') {
      return [];
    }

    return value
      .split(',')
      .map(item => item.trim())
      .filter((item): item is string => item.length > 0 && item !== 'N/A');
  }

  return [];
}

export function normalizeDocumentMetadata(data: RawFrontmatter, path: string): DocumentMetadata {
  const title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title : path;
  const layer = typeof data.layer === 'string' && data.layer.trim() !== '' ? data.layer : 'UNKNOWN';

  return {
    path,
    title,
    layer,
    upstream: normalizeArray(data.upstream),
    downstream: normalizeArray(data.downstream),
  };
}

export function extractDocumentMetadata(content: string, path: string): DocumentMetadata | null {
  try {
    const { data } = matter<RawFrontmatter>(content);
    return normalizeDocumentMetadata(data, path);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[metadata] Failed to parse frontmatter:', error);
    }
    return null;
  }
}
