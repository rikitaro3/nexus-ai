import { collectValidationIssues, validateDocument } from '../validation';

describe('collectValidationIssues', () => {
  it('detects missing required fields', () => {
    const { errors, warnings } = collectValidationIssues({}, '');
    expect(errors).toContain('フロントマターにtitleが必要です');
    expect(errors).toContain('フロントマターにlayerが必要です');
    expect(warnings).toContain('Breadcrumbsセクションがありません');
  });

  it('flags invalid layer values', () => {
    const { errors } = collectValidationIssues({ layer: 'INVALID' }, '> Breadcrumbs');
    expect(errors).toContain('無効なレイヤー: INVALID');
  });

  it('warns about invalid upstream/downstream shapes', () => {
    const { warnings } = collectValidationIssues({ upstream: 123, downstream: { value: 1 } }, '> Breadcrumbs');
    expect(warnings).toEqual([
      'upstreamは配列または文字列である必要があります',
      'downstreamは配列または文字列である必要があります',
    ]);
  });
});

describe('validateDocument', () => {
  it('returns valid true when document passes checks', () => {
    const content = `---\ntitle: Good Doc\nlayer: QA\n---\n> Breadcrumbs`; // eslint-disable-line max-len
    expect(validateDocument(content)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('returns parse error when YAML is invalid', () => {
    const result = validateDocument('---\ntitle: : bad\n---');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('YAMLフロントマターの構文エラー');
  });
});
