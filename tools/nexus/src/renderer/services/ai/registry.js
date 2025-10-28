(function initAiProviderRegistry(globalScope) {
  const globalObject = globalScope || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  if (globalObject && globalObject.aiProviderRegistry && typeof globalObject.aiProviderRegistry.registerProvider === 'function') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = globalObject.aiProviderRegistry;
    }
    return;
  }

  const DEFAULT_PROVIDER_ID = 'cursor';
  const providers = new Map();
  const changeListeners = new Set();
  const tokenUsageListeners = new Set();
  let activeProviderId = null;
  let pendingActiveProviderId = null;

  function toStringSafe(value) {
    if (value == null) return '';
    try {
      return String(value);
    } catch (err) {
      console.warn('[AI] Failed to normalize string value', err);
      return '';
    }
  }

  function normalizeProvider(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('[AI] Provider definition must be an object');
    }
    const id = toStringSafe(raw.id).trim();
    if (!id) {
      throw new Error('[AI] Provider ID is required');
    }
    if (typeof raw.buildBreakdownPrompt !== 'function') {
      throw new Error(`[AI] Provider \"${id}\" must implement buildBreakdownPrompt(context, helpers)`);
    }
    const normalized = {
      id,
      label: toStringSafe(raw.label) || id,
      description: toStringSafe(raw.description),
      buildBreakdownPrompt: raw.buildBreakdownPrompt,
      metadata: raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {},
    };
    return Object.freeze(normalized);
  }

  function notifyProviderChange() {
    const provider = getActiveProvider();
    for (const listener of changeListeners) {
      try {
        listener(provider);
      } catch (err) {
        console.error('[AI] Failed to notify provider listener', err);
      }
    }
  }

  function notifyTokenUsage(payload) {
    if (!payload || typeof payload !== 'object') return;
    const enriched = {
      providerId: payload.providerId || activeProviderId,
      ...payload,
    };
    for (const listener of tokenUsageListeners) {
      try {
        listener(enriched);
      } catch (err) {
        console.error('[AI] Failed to notify token usage listener', err);
      }
    }
  }

  function setActiveProvider(id, options = {}) {
    const normalizedId = toStringSafe(id).trim();
    if (!normalizedId) {
      pendingActiveProviderId = null;
      return false;
    }
    if (!providers.has(normalizedId)) {
      pendingActiveProviderId = normalizedId;
      return false;
    }
    if (activeProviderId === normalizedId && !options.force) {
      if (!options.silent) {
        notifyProviderChange();
      }
      pendingActiveProviderId = null;
      return true;
    }
    activeProviderId = normalizedId;
    pendingActiveProviderId = null;
    if (!options.silent) {
      notifyProviderChange();
    }
    return true;
  }

  function ensureActiveProvider(options = {}) {
    if (activeProviderId && providers.has(activeProviderId)) {
      return providers.get(activeProviderId) || null;
    }
    let candidate = null;
    if (pendingActiveProviderId && providers.has(pendingActiveProviderId)) {
      candidate = pendingActiveProviderId;
    } else if (providers.has(DEFAULT_PROVIDER_ID)) {
      candidate = DEFAULT_PROVIDER_ID;
    } else if (providers.size > 0) {
      const first = providers.keys().next();
      candidate = first.done ? null : first.value;
    }
    if (candidate) {
      setActiveProvider(candidate, { silent: options.silent === true });
      return providers.get(candidate) || null;
    }
    if (!options.silent) {
      notifyProviderChange();
    }
    return null;
  }

  function registerProvider(rawProvider) {
    const normalized = normalizeProvider(rawProvider);
    providers.set(normalized.id, normalized);
    if (pendingActiveProviderId === normalized.id) {
      setActiveProvider(normalized.id, { silent: true });
    }
    ensureActiveProvider({ silent: true });
    return normalized;
  }

  function getProvider(id) {
    const normalizedId = toStringSafe(id).trim();
    if (!normalizedId) return null;
    return providers.get(normalizedId) || null;
  }

  function getActiveProvider() {
    if (!activeProviderId) return null;
    return providers.get(activeProviderId) || null;
  }

  function getActiveProviderId() {
    return activeProviderId;
  }

  function listProviders() {
    return Array.from(providers.values()).map(provider => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      metadata: { ...provider.metadata },
    }));
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => undefined;
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
    };
  }

  function onTokenUsage(listener) {
    if (typeof listener !== 'function') return () => undefined;
    tokenUsageListeners.add(listener);
    return () => {
      tokenUsageListeners.delete(listener);
    };
  }

  function recordTokenUsage(payload) {
    notifyTokenUsage(payload);
  }

  function createProviderSkeleton(overrides = {}) {
    const id = toStringSafe(overrides.id).trim() || 'provider';
    return {
      id,
      label: toStringSafe(overrides.label) || `Provider ${id}`,
      description: toStringSafe(overrides.description),
      metadata: overrides.metadata && typeof overrides.metadata === 'object' ? { ...overrides.metadata } : {},
      buildBreakdownPrompt: typeof overrides.buildBreakdownPrompt === 'function'
        ? overrides.buildBreakdownPrompt
        : function missingImplementation() {
            throw new Error(`[AI:${id}] buildBreakdownPrompt is not implemented`);
          },
    };
  }

  const api = {
    registerProvider,
    getProvider,
    getActiveProvider,
    getActiveProviderId,
    setActiveProvider,
    ensureActiveProvider,
    listProviders,
    subscribe,
    onTokenUsage,
    recordTokenUsage,
    createProviderSkeleton,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalObject) {
    globalObject.aiProviderRegistry = api;
  }

  function restoreFromSettings() {
    if (!globalObject || !globalObject.settings || typeof globalObject.settings.getAiProvider !== 'function') {
      ensureActiveProvider({ silent: true });
      return;
    }
    try {
      Promise.resolve(globalObject.settings.getAiProvider()).then(result => {
        const providerId = toStringSafe(result && (result.providerId || result.id || result.value)).trim();
        if (providerId) {
          setActiveProvider(providerId, { silent: true });
        }
        ensureActiveProvider({ silent: true });
      }).catch(err => {
        console.warn('[AI] Failed to restore provider from settings', err);
        ensureActiveProvider({ silent: true });
      });
    } catch (err) {
      console.warn('[AI] Failed to queue provider restoration', err);
      ensureActiveProvider({ silent: true });
    }
  }

  restoreFromSettings();
})(typeof window !== 'undefined' ? window : undefined);
