import { aiProviderRegistry } from '@/lib/ai/registry';

function asString(value: unknown): string {
  if (value == null) return '';
  try {
    return String(value);
  } catch (error) {
    console.warn('[CursorProvider] Failed to normalise value', error);
    return '';
  }
}

function formatLinks(links: Record<string, string> | undefined): string[] {
  if (!links) return [];
  return Object.entries(links)
    .map(([key, value]) => {
      const safeKey = asString(key).trim();
      const safeValue = asString(value).trim();
      if (!safeKey || !safeValue) return '';
      return `- ${safeKey}: ${safeValue}`;
    })
    .filter(Boolean);
}

const provider = aiProviderRegistry.createProviderSkeleton({
  id: 'cursor',
  label: 'Cursor Auto',
  description: 'Generate breakdown prompts tailored for Cursor auto workflows.',
  metadata: {
    mode: 'manual',
    tokens: 'n/a',
  },
});

provider.buildBreakdownPrompt = (context, helpers) => {
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

  if (helpers?.recordUsage) {
    helpers.recordUsage({ promptTokens: prompt.length, totalTokens: prompt.length });
  }

  return prompt;
};

aiProviderRegistry.registerProvider(provider);
aiProviderRegistry.ensureActiveProvider({ silent: true });

export default provider;
