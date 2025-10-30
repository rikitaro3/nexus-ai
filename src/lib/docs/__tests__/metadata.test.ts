import { extractDocumentMetadata, normalizeArray, normalizeDocumentMetadata } from '../metadata';

describe('normalizeArray', () => {
  it('filters invalid values from array inputs', () => {
    expect(normalizeArray(['one', '', 'N/A', 123, 'two'])).toEqual(['one', 'two']);
  });

  it('splits comma-separated strings and removes placeholders', () => {
    expect(normalizeArray('alpha, beta , N/A ,gamma')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns empty array for unsupported values', () => {
    expect(normalizeArray(undefined)).toEqual([]);
    expect(normalizeArray(null)).toEqual([]);
    expect(normalizeArray(42)).toEqual([]);
  });
});

describe('normalizeDocumentMetadata', () => {
  it('provides fallbacks for missing title and layer', () => {
    const metadata = normalizeDocumentMetadata({}, 'docs/example.mdc');
    expect(metadata).toEqual({
      path: 'docs/example.mdc',
      title: 'docs/example.mdc',
      layer: 'UNKNOWN',
      upstream: [],
      downstream: [],
    });
  });

  it('retains valid values from frontmatter', () => {
    const metadata = normalizeDocumentMetadata(
      {
        title: 'Sample',
        layer: 'PRD',
        upstream: ['docs/foo.mdc'],
        downstream: 'docs/bar.mdc',
      },
      'docs/example.mdc',
    );

    expect(metadata).toEqual({
      path: 'docs/example.mdc',
      title: 'Sample',
      layer: 'PRD',
      upstream: ['docs/foo.mdc'],
      downstream: ['docs/bar.mdc'],
    });
  });
});

describe('extractDocumentMetadata', () => {
  it('parses metadata from markdown content', () => {
    const content = `---\ntitle: Test Doc\nlayer: ARCH\nupstream:\n  - docs/foo.mdc\n---\nBody`; // eslint-disable-line max-len
    const metadata = extractDocumentMetadata(content, 'docs/test.mdc');
    expect(metadata).toEqual({
      path: 'docs/test.mdc',
      title: 'Test Doc',
      layer: 'ARCH',
      upstream: ['docs/foo.mdc'],
      downstream: [],
    });
  });

  it('returns null when parsing fails', () => {
    const content = '---\ntitle: : bad\n---\n';
    expect(extractDocumentMetadata(content, 'docs/test.mdc')).toBeNull();
  });
});
