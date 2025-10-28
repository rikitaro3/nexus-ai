export interface BreakdownContext {
  title: string;
  category: string;
  priority: string;
  featId: string;
  links: Record<string, string>;
}

export interface BreakdownPromptUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface BreakdownPromptHelpers {
  registry: AiProviderRegistry;
  options?: Record<string, unknown>;
  recordUsage?: (usage: BreakdownPromptUsage) => void;
}

export interface AiProvider {
  id: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
  buildBreakdownPrompt: (context: BreakdownContext, helpers?: BreakdownPromptHelpers) => string | { prompt: string; usage?: BreakdownPromptUsage };
}

type Listener<T> = (value: T) => void;

type ProviderChangeListener = Listener<AiProvider | null>;
type TokenUsageListener = Listener<{ providerId?: string } & BreakdownPromptUsage>;

function toStringSafe(value: unknown): string {
  if (value == null) return '';
  try {
    return String(value);
  } catch (error) {
    console.warn('[AI] Failed to normalise string value', error);
    return '';
  }
}

function normaliseProvider(input: AiProvider): AiProvider {
  if (!input || typeof input !== 'object') {
    throw new Error('[AI] Provider definition must be an object');
  }
  const id = toStringSafe(input.id).trim();
  if (!id) {
    throw new Error('[AI] Provider ID is required');
  }
  if (typeof input.buildBreakdownPrompt !== 'function') {
    throw new Error(`[AI] Provider \"${id}\" must implement buildBreakdownPrompt()`);
  }
  return Object.freeze({
    id,
    label: toStringSafe(input.label) || id,
    description: toStringSafe(input.description),
    metadata: input.metadata ? { ...input.metadata } : {},
    buildBreakdownPrompt: input.buildBreakdownPrompt,
  });
}

export class AiProviderRegistry {
  private providers = new Map<string, AiProvider>();

  private changeListeners = new Set<ProviderChangeListener>();

  private tokenUsageListeners = new Set<TokenUsageListener>();

  private activeProviderId: string | null = null;

  private pendingActiveProviderId: string | null = null;

  registerProvider(provider: AiProvider): AiProvider {
    const normalised = normaliseProvider(provider);
    this.providers.set(normalised.id, normalised);
    if (this.pendingActiveProviderId === normalised.id) {
      this.setActiveProvider(normalised.id, { silent: true });
    }
    this.ensureActiveProvider({ silent: true });
    return normalised;
  }

  getProvider(id: string | undefined | null): AiProvider | null {
    const lookup = toStringSafe(id).trim();
    if (!lookup) return null;
    return this.providers.get(lookup) ?? null;
  }

  getActiveProvider(): AiProvider | null {
    if (!this.activeProviderId) return null;
    return this.providers.get(this.activeProviderId) ?? null;
  }

  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  setActiveProvider(id: string | undefined | null, options: { silent?: boolean; force?: boolean } = {}): boolean {
    const lookup = toStringSafe(id).trim();
    if (!lookup) {
      this.pendingActiveProviderId = null;
      return false;
    }
    if (!this.providers.has(lookup)) {
      this.pendingActiveProviderId = lookup;
      return false;
    }
    if (this.activeProviderId === lookup && !options.force) {
      if (!options.silent) {
        this.notifyChange();
      }
      this.pendingActiveProviderId = null;
      return true;
    }
    this.activeProviderId = lookup;
    this.pendingActiveProviderId = null;
    if (!options.silent) {
      this.notifyChange();
    }
    return true;
  }

  ensureActiveProvider(options: { silent?: boolean } = {}): AiProvider | null {
    if (this.activeProviderId && this.providers.has(this.activeProviderId)) {
      return this.providers.get(this.activeProviderId) ?? null;
    }
    let candidate: string | null = null;
    if (this.pendingActiveProviderId && this.providers.has(this.pendingActiveProviderId)) {
      candidate = this.pendingActiveProviderId;
    } else if (this.providers.has('cursor')) {
      candidate = 'cursor';
    } else if (this.providers.size > 0) {
      const first = this.providers.keys().next();
      candidate = first.done ? null : first.value;
    }
    if (candidate) {
      this.setActiveProvider(candidate, { silent: options.silent === true });
      return this.providers.get(candidate) ?? null;
    }
    if (!options.silent) {
      this.notifyChange();
    }
    return null;
  }

  listProviders(): Array<{ id: string; label: string; description?: string; metadata: Record<string, unknown> }> {
    return Array.from(this.providers.values()).map(provider => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      metadata: { ...provider.metadata },
    }));
  }

  subscribe(listener: ProviderChangeListener): () => void {
    if (typeof listener !== 'function') {
      return () => undefined;
    }
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  onTokenUsage(listener: TokenUsageListener): () => void {
    if (typeof listener !== 'function') {
      return () => undefined;
    }
    this.tokenUsageListeners.add(listener);
    return () => {
      this.tokenUsageListeners.delete(listener);
    };
  }

  recordTokenUsage(payload: BreakdownPromptUsage & { providerId?: string }): void {
    const enriched = { providerId: payload.providerId ?? this.activeProviderId ?? undefined, ...payload };
    for (const listener of this.tokenUsageListeners) {
      try {
        listener(enriched);
      } catch (error) {
        console.error('[AI] Failed to notify token usage listener', error);
      }
    }
  }

  createProviderSkeleton(overrides: Partial<AiProvider> = {}): AiProvider {
    const id = toStringSafe(overrides.id).trim() || 'provider';
    const skeleton: AiProvider = {
      id,
      label: toStringSafe(overrides.label) || `Provider ${id}`,
      description: toStringSafe(overrides.description),
      metadata: overrides.metadata ? { ...overrides.metadata } : {},
      buildBreakdownPrompt:
        typeof overrides.buildBreakdownPrompt === 'function'
          ? overrides.buildBreakdownPrompt
          : () => {
              throw new Error(`[AI:${id}] buildBreakdownPrompt is not implemented`);
            },
    };
    return skeleton;
  }

  private notifyChange() {
    const provider = this.getActiveProvider();
    for (const listener of this.changeListeners) {
      try {
        listener(provider);
      } catch (error) {
        console.error('[AI] Failed to notify provider listener', error);
      }
    }
  }
}

const globalObject: Record<string, unknown> | undefined =
  typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined;

export const aiProviderRegistry: AiProviderRegistry = (() => {
  const existing = globalObject?.aiProviderRegistry;
  if (existing && typeof existing === 'object' && 'registerProvider' in existing) {
    return existing as AiProviderRegistry;
  }
  const registry = new AiProviderRegistry();
  if (globalObject) {
    globalObject.aiProviderRegistry = registry;
  }
  return registry;
})();
