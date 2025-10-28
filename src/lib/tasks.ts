import { aiProviderRegistry, AiProvider, BreakdownContext } from '@/lib/ai/registry';
import '@/lib/ai/providers/cursor';

export interface Task {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  featId: string;
  links: Record<string, string>;
  notes: string;
  breakdownPrompt: string;
  breakdownStatus: string;
  lastBreakdownAt: string;
  promptPartIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ParseOptions {
  uidFn?: () => string;
  timestampFn?: () => string;
}

function taskDefaults(): Pick<Task, 'notes' | 'breakdownPrompt' | 'breakdownStatus' | 'lastBreakdownAt' | 'promptPartIds'> {
  return {
    notes: '',
    breakdownPrompt: '',
    breakdownStatus: 'DRAFT',
    lastBreakdownAt: '',
    promptPartIds: [],
  };
}

function defaultUid() {
  return 'T' + Math.random().toString(36).slice(2, 10);
}

function defaultTimestamp() {
  return new Date().toISOString();
}

export function normalizeBreakdownContext(raw: Record<string, unknown> = {}): BreakdownContext {
  return {
    title: typeof raw?.title === 'string' ? raw.title : '',
    category: typeof raw?.category === 'string' ? raw.category : '',
    priority: typeof raw?.priority === 'string' ? raw.priority : '',
    featId: typeof raw?.featId === 'string' ? raw.featId : '',
    links: raw?.links && typeof raw.links === 'object' ? { ...(raw.links as Record<string, string>) } : {},
  };
}

export function applyTaskDefaults(raw: Partial<Task> = {}): Task {
  const base = taskDefaults();
  const merged: Task = {
    id: raw.id ?? defaultUid(),
    title: typeof raw.title === 'string' ? raw.title : '',
    category: typeof raw.category === 'string' ? raw.category : 'Uncategorized',
    priority: typeof raw.priority === 'string' ? raw.priority : 'MEDIUM',
    status: typeof raw.status === 'string' ? raw.status : 'TODO',
    featId: typeof raw.featId === 'string' ? raw.featId : '',
    links: raw.links ? { ...raw.links } : {},
    notes: typeof raw.notes === 'string' ? raw.notes : base.notes,
    breakdownPrompt: typeof raw.breakdownPrompt === 'string' ? raw.breakdownPrompt : base.breakdownPrompt,
    breakdownStatus: typeof raw.breakdownStatus === 'string' ? raw.breakdownStatus : base.breakdownStatus,
    lastBreakdownAt: typeof raw.lastBreakdownAt === 'string' ? raw.lastBreakdownAt : base.lastBreakdownAt,
    promptPartIds: Array.isArray(raw.promptPartIds)
      ? raw.promptPartIds
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map(id => id.trim())
      : base.promptPartIds,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : defaultTimestamp(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : defaultTimestamp(),
  };
  return merged;
}

export function parsePasted(text: string, options: ParseOptions = {}): Task[] {
  const { uidFn = defaultUid, timestampFn = defaultTimestamp } = options;
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const tasks: Task[] = [];
  for (const line of lines) {
    const match = line.match(/^【([^】]+)】\s*(.+)$/);
    const category = match ? match[1] : 'Uncategorized';
    const title = match ? match[2] : line;
    const timestamp = timestampFn();
    tasks.push(
      applyTaskDefaults({
        id: uidFn(),
        title,
        category,
        priority: 'MEDIUM',
        status: 'TODO',
        featId: '',
        links: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  }
  return tasks;
}

function buildDefaultBreakdownPrompt(context: BreakdownContext): string {
  const linksText = Object.entries(context.links)
    .map(([key, value]) => {
      const label = typeof key === 'string' ? key.trim() : String(key ?? '').trim();
      const target = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      if (!label || !target) return '';
      return `- ${label}: ${target}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    'あなたはプロジェクトの実装ブレークダウン設計者です。以下の制約と入力を踏まえ、MECEなサブタスク（各項目に完了基準付き）を5〜10件で提案し、不明点（最大5件）と参照先（PRD/UX/API/DATA/QA）も挙げてください。',
    '',
    '[制約]',
    '- 外部依存を最小化し、チームが即着手できる粒度で提示すること',
    '- 冗長禁止、簡潔さ重視',
    '- DAG/MECE/Quality Gatesを尊重（context.mdc参照）',
    '',
    '[入力]',
    `- タスク: ${context.title} / カテゴリ: ${context.category} / 優先度: ${context.priority} / FEAT: ${context.featId}`,
    '- 関連ドキュメント:',
    linksText || '- (なし)',
    '',
    '[出力]',
    '- サブタスク一覧: [ {name, acceptanceCriteria, refs} ... ]',
    '- 不明点: [question1..]',
    '- 参照: [PRD/UX/API/DATA/QAの相対パスとアンカー]',
    '',
    '※ AIプロバイダー未設定時のフォールバックテンプレートです。',
  ].join('\n');
}

export function resolveBreakdownProvider(providerId?: string): AiProvider | null {
  if (!aiProviderRegistry) return null;
  const lookup = typeof providerId === 'string' ? providerId.trim() : '';
  if (lookup) {
    const explicit = aiProviderRegistry.getProvider(lookup);
    if (explicit) {
      aiProviderRegistry.setActiveProvider(lookup, { silent: true });
      return explicit;
    }
    aiProviderRegistry.setActiveProvider(lookup, { silent: true });
  }
  const active = aiProviderRegistry.getActiveProvider();
  if (active) return active;
  const ensured = aiProviderRegistry.ensureActiveProvider({ silent: true });
  if (ensured) return ensured;
  const providers = aiProviderRegistry.listProviders();
  if (providers.length) {
    const first = aiProviderRegistry.getProvider(providers[0].id);
    if (first) return first;
  }
  return null;
}

function callFallbackPrompt(context: BreakdownContext, failingProviderId?: string): string {
  const attempted = new Set<string>();
  const candidates: AiProvider[] = [];

  const active = aiProviderRegistry.getActiveProvider();
  if (active) candidates.push(active);

  const ensured = aiProviderRegistry.ensureActiveProvider({ silent: true });
  if (ensured) candidates.push(ensured);

  for (const info of aiProviderRegistry.listProviders()) {
    const provider = aiProviderRegistry.getProvider(info.id);
    if (provider) {
      candidates.push(provider);
    }
  }

  for (const provider of candidates) {
    if (!provider || typeof provider.buildBreakdownPrompt !== 'function') continue;
    if (provider.id && provider.id === failingProviderId) continue;
    if (provider.id && attempted.has(provider.id)) continue;
    if (provider.id) attempted.add(provider.id);
    try {
      const result = provider.buildBreakdownPrompt(context, { registry: aiProviderRegistry, options: { reason: 'fallback' } });
      if (typeof result === 'string') {
        return result;
      }
      if (result && typeof result === 'object' && typeof (result as { prompt?: string }).prompt === 'string') {
        const prompt = (result as { prompt: string }).prompt;
        const usage = (result as { usage?: unknown }).usage;
        if (usage && typeof usage === 'object') {
          aiProviderRegistry.recordTokenUsage({ providerId: provider.id, ...(usage as Record<string, unknown>) });
        }
        return prompt;
      }
    } catch (error) {
      console.warn(`[Tasks] Fallback provider ${provider?.id ?? 'unknown'} failed`, error);
    }
  }

  return buildDefaultBreakdownPrompt(context);
}

function normalizePromptResult(result: unknown, context: BreakdownContext, provider: AiProvider | null): string {
  if (result && typeof result === 'object') {
    const prompt = typeof (result as { prompt?: string }).prompt === 'string' ? (result as { prompt: string }).prompt : '';
    if (prompt) {
      const usage = (result as { usage?: Record<string, unknown> }).usage;
      if (usage && aiProviderRegistry && typeof aiProviderRegistry.recordTokenUsage === 'function') {
        aiProviderRegistry.recordTokenUsage({ providerId: provider?.id, ...(usage as Record<string, unknown>) });
      }
      return prompt;
    }
  }
  if (typeof result === 'string') {
    return result;
  }
  return callFallbackPrompt(context, provider?.id);
}

export function buildBreakdownPrompt(rawContext: Record<string, unknown>, options: { providerId?: string } = {}): string {
  const context = normalizeBreakdownContext(rawContext);
  const provider = resolveBreakdownProvider(options.providerId);
  if (!provider || typeof provider.buildBreakdownPrompt !== 'function') {
    return callFallbackPrompt(context);
  }

  let usageRecorded = false;
  const helpers = {
    registry: aiProviderRegistry,
    options,
    recordUsage(usage: unknown) {
      if (!usage || typeof usage !== 'object') return;
      usageRecorded = true;
      aiProviderRegistry.recordTokenUsage({ providerId: provider.id, ...(usage as Record<string, unknown>) });
    },
  };

  let result: unknown;
  try {
    result = provider.buildBreakdownPrompt(context, helpers);
  } catch (error) {
    console.error(`[Tasks] Provider ${provider?.id ?? 'unknown'} failed to build breakdown prompt`, error);
    return callFallbackPrompt(context, provider?.id);
  }

  if (!usageRecorded && result && typeof result === 'object' && (result as { usage?: unknown }).usage) {
    helpers.recordUsage((result as { usage: unknown }).usage);
  }

  return normalizePromptResult(result, context, provider);
}
