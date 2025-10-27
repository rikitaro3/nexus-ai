(function initCursorProvider(globalScope) {
  const globalObject = globalScope || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  const registry = (globalObject && globalObject.aiProviderRegistry)
    ? globalObject.aiProviderRegistry
    : (typeof require === 'function'
        ? (() => {
            try {
              return require('../registry.js');
            } catch (err) {
              console.warn('[AI] Failed to require registry for Cursor provider', err);
              return null;
            }
          })()
        : null);

  if (!registry || typeof registry.registerProvider !== 'function') {
    console.warn('[AI] Cursor provider could not register (registry unavailable)');
    return;
  }

  function asString(value) {
    if (value == null) return '';
    try {
      return String(value);
    } catch (err) {
      console.warn('[AI] Failed to normalize context value', err);
      return '';
    }
  }

  function formatLinks(links) {
    if (!links || typeof links !== 'object') {
      return [];
    }
    const lines = [];
    for (const [rawKey, rawValue] of Object.entries(links)) {
      const key = asString(rawKey).trim();
      const value = asString(rawValue).trim();
      if (!key || !value) continue;
      lines.push(`- ${key}: ${value}`);
    }
    return lines;
  }

  const provider = registry.createProviderSkeleton
    ? registry.createProviderSkeleton({
        id: 'cursor',
        label: 'Cursor Auto',
        description: 'Generate breakdown prompts tailored for Cursor auto workflows.',
        metadata: {
          mode: 'manual',
          tokens: 'n/a',
        },
      })
    : {
        id: 'cursor',
        label: 'Cursor Auto',
        description: 'Generate breakdown prompts tailored for Cursor auto workflows.',
        metadata: {
          mode: 'manual',
          tokens: 'n/a',
        },
      };

  provider.buildBreakdownPrompt = function buildCursorBreakdownPrompt(context, helpers = {}) {
    const title = asString(context?.title).trim();
    const category = asString(context?.category).trim();
    const priority = asString(context?.priority).trim();
    const featId = asString(context?.featId).trim();
    const links = formatLinks(context?.links);

    const header = 'あなたはプロジェクトの実装ブレークダウン設計者です。以下の制約と入力を踏まえ、MECEなサブタスク（各項目に完了基準付き）を5〜10件で提案し、不明点（最大5件）と参照先（PRD/UX/API/DATA/QA）も挙げてください。';
    const constraints = [
      '[制約]',
      '- 外部AI APIを使わない（Cursor autoのみ）',
      '- 冗長禁止、簡潔さ重視',
      '- DAG/MECE/Quality Gatesを尊重（context.mdc参照）',
    ];
    const inputs = [
      '[入力]',
      `- タスク: ${title} / カテゴリ: ${category} / 優先度: ${priority} / FEAT: ${featId}`.trim(),
      '- 関連ドキュメント:',
      links.length ? links.join('\n') : '- (なし)',
    ];
    const outputs = [
      '[出力]',
      '- サブタスク一覧: [ {name, acceptanceCriteria, refs} ... ]',
      '- 不明点: [question1..]',
      '- 参照: [PRD/UX/API/DATA/QAの相対パスとアンカー]',
    ];

    const prompt = [header, '', ...constraints, '', ...inputs, '', ...outputs].join('\n');

    if (helpers && typeof helpers.recordUsage === 'function') {
      try {
        helpers.recordUsage({ promptTokens: prompt.length, completionTokens: 0, totalTokens: prompt.length });
      } catch (err) {
        console.warn('[AI] Failed to record Cursor provider usage', err);
      }
    }

    return prompt;
  };

  registry.registerProvider(provider);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = provider;
  }
})(typeof window !== 'undefined' ? window : undefined);
