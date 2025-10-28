// Ported Tasks (import/edit/save/export/breakdown)
(function initTasksModule() {
  const aiProviderRegistry = (() => {
    if (typeof window !== 'undefined' && window.aiProviderRegistry) {
      return window.aiProviderRegistry;
    }
    if (typeof require === 'function') {
      try {
        const registry = require('../../services/ai/registry.js');
        try {
          require('../../services/ai/providers/cursor.js');
        } catch (err) {
          if (!err || err.code !== 'MODULE_NOT_FOUND') {
            console.warn('[Tasks] Failed to preload Cursor provider for Node context:', err);
          }
        }
        if (registry && typeof registry.ensureActiveProvider === 'function') {
          registry.ensureActiveProvider({ silent: true });
        }
        return registry;
      } catch (err) {
        console.warn('[Tasks] Failed to load AI provider registry in Node context:', err);
      }
    }
    return null;
  })();

  function normalizeBreakdownContext(raw = {}) {
    return {
      title: typeof raw?.title === 'string' ? raw.title : '',
      category: typeof raw?.category === 'string' ? raw.category : '',
      priority: typeof raw?.priority === 'string' ? raw.priority : '',
      featId: typeof raw?.featId === 'string' ? raw.featId : '',
      links: raw?.links && typeof raw.links === 'object' ? { ...raw.links } : {},
    };
  }

  function buildDefaultBreakdownPrompt(context) {
    const linksText = Object.entries(context?.links || {})
      .map(([key, value]) => {
        const label = key == null ? '' : String(key).trim();
        const target = value == null ? '' : String(value).trim();
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
      '※ AIプロバイダー未設定時のフォールバックテンプレートです。'
    ].join('\n');
  }

  function resolveBreakdownProvider(providerId) {
    if (!aiProviderRegistry) {
      return null;
    }

    const lookupId = typeof providerId === 'string' ? providerId.trim() : '';
    if (lookupId) {
      if (typeof aiProviderRegistry.getProvider === 'function') {
        const explicit = aiProviderRegistry.getProvider(lookupId);
        if (explicit) {
          if (typeof aiProviderRegistry.setActiveProvider === 'function') {
            aiProviderRegistry.setActiveProvider(lookupId, { silent: true });
          }
          return explicit;
        }
      }
      if (typeof aiProviderRegistry.setActiveProvider === 'function') {
        aiProviderRegistry.setActiveProvider(lookupId, { silent: true });
      }
    }

    if (typeof aiProviderRegistry.getActiveProvider === 'function') {
      const active = aiProviderRegistry.getActiveProvider();
      if (active) return active;
    }

    if (typeof aiProviderRegistry.ensureActiveProvider === 'function') {
      const ensured = aiProviderRegistry.ensureActiveProvider({ silent: true });
      if (ensured) return ensured;
    }

    if (typeof aiProviderRegistry.listProviders === 'function' && typeof aiProviderRegistry.getProvider === 'function') {
      const available = aiProviderRegistry.listProviders();
      if (Array.isArray(available) && available.length) {
        const first = aiProviderRegistry.getProvider(available[0].id);
        if (first) return first;
      }
    }

    return null;
  }

  function taskDefaults() {
    return {
      notes: '',
      breakdownPrompt: '',
      breakdownStatus: 'DRAFT',
      lastBreakdownAt: '',
      promptPartIds: [],
    };
  }

  function applyTaskDefaults(raw = {}) {
    const merged = {
      ...taskDefaults(),
      ...raw,
    };
    merged.notes = typeof raw?.notes === 'string' ? raw.notes : '';
    merged.breakdownPrompt = typeof raw?.breakdownPrompt === 'string' ? raw.breakdownPrompt : '';
    merged.breakdownStatus = raw?.breakdownStatus || 'DRAFT';
    merged.lastBreakdownAt = raw?.lastBreakdownAt || '';
    merged.promptPartIds = Array.isArray(raw?.promptPartIds)
      ? raw.promptPartIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
      : [];
    return merged;
  }

  function defaultUid() {
    return 'T' + Math.random().toString(36).slice(2, 10);
  }

  function defaultTimestamp() {
    return new Date().toISOString();
  }

  function parsePasted(text, options = {}) {
    const { uidFn = defaultUid, timestampFn = defaultTimestamp } = options;
    const out = [];
    if (!text) return out;
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^【([^】]+)】\s*(.+)$/);
      const category = match ? match[1] : 'Uncategorized';
      const title = match ? match[2] : line;
      const timestamp = timestampFn();
      out.push(applyTaskDefaults({
        id: uidFn(),
        title,
        category,
        priority: 'MEDIUM',
        status: 'TODO',
        featId: '',
        links: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
    }
    return out;
  }

  function callFallbackPrompt(context, failingProviderId) {
    if (!aiProviderRegistry) {
      return buildDefaultBreakdownPrompt(context);
    }

    const attempted = new Set();
    const candidates = [];

    if (typeof aiProviderRegistry.getActiveProvider === 'function') {
      const active = aiProviderRegistry.getActiveProvider();
      if (active) candidates.push(active);
    }

    if (typeof aiProviderRegistry.ensureActiveProvider === 'function') {
      const ensured = aiProviderRegistry.ensureActiveProvider({ silent: true });
      if (ensured) candidates.push(ensured);
    }

    if (typeof aiProviderRegistry.listProviders === 'function' && typeof aiProviderRegistry.getProvider === 'function') {
      const listed = aiProviderRegistry.listProviders();
      if (Array.isArray(listed)) {
        for (const item of listed) {
          if (!item || typeof item.id !== 'string') continue;
          const provider = aiProviderRegistry.getProvider(item.id);
          if (provider) {
            candidates.push(provider);
          }
        }
      }
    }

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.buildBreakdownPrompt !== 'function') continue;
      if (candidate.id && candidate.id === failingProviderId) continue;
      if (candidate.id && attempted.has(candidate.id)) continue;
      if (candidate.id) attempted.add(candidate.id);
      try {
        return candidate.buildBreakdownPrompt(context, {
          registry: aiProviderRegistry,
          reason: 'fallback',
        });
      } catch (err) {
        console.warn(`[Tasks] Fallback provider ${candidate?.id || 'unknown'} failed:`, err);
      }
    }

    return buildDefaultBreakdownPrompt(context);
  }

  function normalizePromptResult(result, context, provider) {
    if (result && typeof result === 'object' && result !== null) {
      const prompt = typeof result.prompt === 'string' ? result.prompt : '';
      if (prompt) {
        if (result.usage && aiProviderRegistry && typeof aiProviderRegistry.recordTokenUsage === 'function') {
          aiProviderRegistry.recordTokenUsage({ providerId: provider?.id, ...result.usage });
        }
        return prompt;
      }
    }

    if (typeof result === 'string') {
      return result;
    }

    return callFallbackPrompt(context, provider?.id);
  }

  function buildBreakdownPrompt(rawContext, options = {}) {
    const context = normalizeBreakdownContext(rawContext);
    const provider = resolveBreakdownProvider(options?.providerId);
    if (!provider || typeof provider.buildBreakdownPrompt !== 'function') {
      return callFallbackPrompt(context);
    }

    let result;
    let usageRecorded = false;
    const helpers = {
      registry: aiProviderRegistry,
      options,
      recordUsage(usage) {
        if (!usage || !aiProviderRegistry || typeof aiProviderRegistry.recordTokenUsage !== 'function') return;
        usageRecorded = true;
        aiProviderRegistry.recordTokenUsage({ providerId: provider.id, ...usage });
      },
    };

    try {
      result = provider.buildBreakdownPrompt(context, helpers);
    } catch (err) {
      console.error(`[Tasks] Provider ${provider?.id || 'unknown'} failed to build breakdown prompt:`, err);
      return callFallbackPrompt(context, provider?.id);
    }

    if (!usageRecorded && result && typeof result === 'object' && result !== null && result.usage) {
      helpers.recordUsage(result.usage);
    }

    return normalizePromptResult(result, context, provider);
  }

  function promptLibraryDefaults() {
    return {
      version: 1,
      metadata: {
        description: '',
        updatedAt: '',
      },
      categories: [],
    };
  }

  function normalizePromptLibrary(raw = {}) {
    const base = promptLibraryDefaults();
    const version = typeof raw?.version === 'number' ? raw.version : base.version;
    const metadata = {
      description: typeof raw?.metadata?.description === 'string' ? raw.metadata.description : '',
      updatedAt: typeof raw?.metadata?.updatedAt === 'string' ? raw.metadata.updatedAt : '',
    };
    const categories = Array.isArray(raw?.categories)
      ? raw.categories.map(normalizePromptCategory).filter(cat => cat.id)
      : [];
    return { version, metadata, categories };
  }

  function normalizePromptCategory(raw = {}) {
    const id = typeof raw?.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : typeof raw?.key === 'string' && raw.key.trim()
        ? raw.key.trim()
        : '';
    const label = typeof raw?.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : typeof raw?.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : id;
    const description = typeof raw?.description === 'string' ? raw.description : '';
    const items = Array.isArray(raw?.items)
      ? raw.items.map(normalizePromptItem).filter(item => item.id)
      : [];
    return { id, label, description, items };
  }

  function normalizePromptItem(raw = {}) {
    const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const title = typeof raw?.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : id;
    const body = typeof raw?.body === 'string'
      ? raw.body
      : typeof raw?.text === 'string'
        ? raw.text
        : '';
    const description = typeof raw?.description === 'string' ? raw.description : '';
    const tags = Array.isArray(raw?.tags)
      ? raw.tags.map(tag => (tag != null ? String(tag) : '')).filter(Boolean)
      : [];
    return { id, title, body, description, tags };
  }

  function slugifyPromptId(value) {
    if (!value) return '';
    return String(value)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9\-_/]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
      .toUpperCase();
  }

  function collectPromptItemIds() {
    const ids = new Set();
    for (const category of promptLibrary.categories) {
      for (const item of category.items) {
        ids.add(item.id);
      }
    }
    return ids;
  }

  function generatePromptItemId(categoryId) {
    const base = (categoryId || 'PROMPT')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-');
    const ids = collectPromptItemIds();
    let index = 1;
    let candidate = `${base}-${String(index).padStart(2, '0')}`;
    while (ids.has(candidate)) {
      index += 1;
      candidate = `${base}-${String(index).padStart(2, '0')}`;
    }
    return candidate;
  }

  function findPromptCategory(id) {
    if (!id) return null;
    return promptLibrary.categories.find(cat => cat.id === id) || null;
  }

  function findPromptItem(id) {
    if (!id) return null;
    for (const category of promptLibrary.categories) {
      const found = category.items.find(item => item.id === id);
      if (found) return found;
    }
    return null;
  }

  function getSelectedPromptItems() {
    const items = [];
    for (const id of promptSelection) {
      const item = findPromptItem(id);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  async function ensurePromptLibraryLoaded() {
    if (promptLibraryLoaded) return promptLibrary;
    if (typeof window === 'undefined' || !window.prompts || typeof window.prompts.readJson !== 'function') {
      promptLibraryLoaded = true;
      promptLibrary = promptLibraryDefaults();
      return promptLibrary;
    }
    try {
      const res = await window.prompts.readJson();
      if (res && res.success && res.data) {
        promptLibrary = normalizePromptLibrary(res.data);
      } else {
        promptLibrary = promptLibraryDefaults();
      }
    } catch (err) {
      console.error('Failed to load prompts.json', err);
      promptLibrary = promptLibraryDefaults();
    }
    promptLibraryLoaded = true;
    if (!promptCategoryId && promptLibrary.categories.length) {
      promptCategoryId = promptLibrary.categories[0].id;
    }
    return promptLibrary;
  }

  let promptLibrary = promptLibraryDefaults();
  let promptLibraryLoaded = false;
  let promptLibraryDirty = false;
  let promptCategoryId = '';
  let promptActiveItemId = '';
  let promptSearchQuery = '';
  let promptSelection = new Set();
  let promptStatusTimer = null;
  let currentTaskForPrompts = null;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      taskDefaults,
      applyTaskDefaults,
      parsePasted,
      normalizeBreakdownContext,
      resolveBreakdownProvider,
      buildBreakdownPrompt,
    };
  }

  if (typeof document === 'undefined') {
    return;
  }

  const STORAGE_KEYS = {
    filter: 'nexus.tasks.filter',
    category: 'nexus.tasks.category'
  };

  function normalizePreferenceValue(value) {
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    try {
      return String(value).trim();
    } catch (err) {
      console.warn('[Tasks] Failed to normalize preference value:', err);
      return '';
    }
  }

  function createStringPreference(storageKey, { defaultValue = '', validate } = {}) {
    const hasStorage = () => typeof window !== 'undefined' && !!window.localStorage;

    function read() {
      if (!hasStorage()) return defaultValue;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw == null) return defaultValue;
        const normalized = normalizePreferenceValue(raw);
        if (!normalized) return defaultValue;
        if (validate && !validate(normalized)) return defaultValue;
        return normalized;
      } catch (err) {
        console.warn('[Tasks] Failed to read preference from storage:', storageKey, err);
        return defaultValue;
      }
    }

    function write(value) {
      if (!hasStorage()) return defaultValue;
      try {
        const normalized = normalizePreferenceValue(value);
        if (!normalized) {
          window.localStorage.removeItem(storageKey);
          return defaultValue;
        }
        if (validate && !validate(normalized)) {
          window.localStorage.removeItem(storageKey);
          return defaultValue;
        }
        window.localStorage.setItem(storageKey, normalized);
        return normalized;
      } catch (err) {
        console.warn('[Tasks] Failed to persist preference:', storageKey, err);
        return defaultValue;
      }
    }

    function clear() {
      if (!hasStorage()) return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch (err) {
        console.warn('[Tasks] Failed to clear preference:', storageKey, err);
      }
    }

    return { read, write, clear };
  }

  const filterPreference = createStringPreference(STORAGE_KEYS.filter, { defaultValue: '' });
  const categoryPreference = createStringPreference(STORAGE_KEYS.category, { defaultValue: '' });

  function persistFilterValue(raw) {
    filterPreference.write(raw || '');
  }

  function persistCategoryValue(category) {
    categoryPreference.write(category || '');
  }

  const listEl = document.getElementById('tasks-list');
  const catsEl = document.getElementById('tasks-categories');
  const detailEl = document.getElementById('task-detail');
  const saveBtn = document.getElementById('tasks-save');
  const exportBtn = document.getElementById('tasks-export');
  const filterInput = document.getElementById('tasks-filter');
  const bulkTextarea = document.getElementById('tasks-bulk');
  const bulkImportBtn = document.getElementById('tasks-bulk-import');
  const addCatInput = document.getElementById('tasks-add-category');
  const addTitleInput = document.getElementById('tasks-add-title');
  const addOneBtn = document.getElementById('tasks-add-one');
  const catsEmptyEl = document.getElementById('tasks-categories-empty');
  const listEmptyEl = document.getElementById('tasks-list-empty');
  const recommendationPanel = document.getElementById('tasks-recommendations');
  const recommendationListEl = document.getElementById('tasks-recommendations-list');
  const recommendationStatusEl = document.getElementById('tasks-recommendations-status');
  const recommendationRefreshBtn = document.getElementById('tasks-recommendations-refresh');

  const persistedFilterRaw = filterPreference.read();
  const persistedCategoryRaw = categoryPreference.read();
  const persistedCategory = persistedCategoryRaw && persistedCategoryRaw.length > 0
    ? persistedCategoryRaw
    : null;

  if (filterInput) {
    filterInput.value = persistedFilterRaw;
  }

  if (!listEl || !catsEl || !detailEl) return;

  let tasks = [];
  let searchQueryRaw = persistedFilterRaw.trim();
  let searchQuery = searchQueryRaw.toLowerCase();
  let selectedTaskCategory = persistedCategory && persistedCategory.trim()
    ? persistedCategory.trim()
    : null;
  let selectedTaskId = null;
  let featsRegistry = null;

  const recommendationAnalysisState = {
    artifacts: null,
    loadingPromise: null,
    lastError: null,
    lastUpdated: null
  };
  let recommendationRefreshPromise = null;
  let recommendationRefreshQueued = false;
  let latestRecommendations = [];

  const PRIORITY_WEIGHTS = { HIGH: 5, MEDIUM: 3, LOW: 1 };
  const STATUS_WEIGHTS = { TODO: 4, READY: 3, IN_PROGRESS: 2, REVIEW: 2, BLOCKED: 5, BACKLOG: 1 };
  const COVERAGE_WEIGHT = 2;
  const GATE_ERROR_WEIGHT = 3;
  const GATE_WARN_WEIGHT = 2;
  const LAYER_GATE_WEIGHT = 2;

  function toggleEmpty(el, show, message) {
    if (!el) return;
    if (typeof message === 'string') el.textContent = message;
    el.classList.toggle('hidden', !show);
  }

  function showTaskDetailPlaceholder(message) {
    detailEl.classList.add('empty-state');
    detailEl.textContent = message;
  }
  async function loadFeats() {
    if (featsRegistry) return featsRegistry;
    const res = await window.docs.read('docs/PRD/index.mdc');
    const out = { items: [] };
    if (!res.success) return out;
    const text = res.content; const secStart = text.indexOf('## Features Registry'); if (secStart === -1) return out;
    const sec = text.slice(secStart); const end = sec.indexOf('\n## '); const body = (end === -1 ? sec : sec.slice(0, end));
    const lines = body.split('\n'); let cur = null;
    for (const raw of lines) { const line = raw.trim(); const h = line.match(/^\-\s*(FEAT-\d{4}):\s*(.+)$/); if (h) { cur = { id: h[1], title: h[2], links: {} }; out.items.push(cur); continue; } if (!cur) continue; const lk = line.match(/^\-\s*(PRD|UX|API|DATA|QA):\s*(.+)$/); if (lk) cur.links[lk[1]] = lk[2]; }
    featsRegistry = out; return out;
  }

  function safeLocalStorageGet(key) {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
  }

  function extractSection(text, startHeader, stopHeaderPrefix = '## ') {
    if (!text || !startHeader) return '';
    const startIdx = text.indexOf(startHeader);
    if (startIdx === -1) return '';
    const after = text.slice(startIdx);
    const rest = after.slice(startHeader.length);
    if (!stopHeaderPrefix) return after.trim();
    const escapedPrefix = stopHeaderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\n${escapedPrefix}`);
    const match = regex.exec(rest);
    if (!match) return after.trim();
    return after.slice(0, startHeader.length + match.index).trim();
  }

  function extractBreadcrumbs(text) {
    if (!text) return '';
    const match = text.match(/>\s*Breadcrumbs[\s\S]*?(?=\n#|\n##|$)/);
    return match ? match[0] : '';
  }

  function parseContextEntriesFromSection(sectionText) {
    const entries = [];
    if (!sectionText) return entries;
    const lines = sectionText.split('\n');
    let currentCategory = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const catMatch = line.match(/^###\s+(.+)$/);
      if (catMatch) {
        currentCategory = catMatch[1].trim();
        continue;
      }
      const itemMatch = line.match(/^\-\s+([^\s].*?)\s+…\s+(.*)$/);
      if (itemMatch && currentCategory) {
        entries.push({
          category: currentCategory,
          path: itemMatch[1].trim(),
          desc: itemMatch[2].trim()
        });
      }
    }
    return entries;
  }

  async function loadContextEntriesForRecommendations() {
    if (Array.isArray(window?.entries) && window.entries.length) {
      return window.entries;
    }
    const customPath = safeLocalStorageGet('context-file-path');
    const savedContext = safeLocalStorageGet('nexus.context');
    let contextPath = customPath || (savedContext === 'nexus' ? 'context.mdc' : '.cursor/context.mdc');
    let ctxRes = await window.docs.read(contextPath);
    if (!ctxRes.success && contextPath !== 'context.mdc') {
      const fallbackRes = await window.docs.read('context.mdc');
      if (fallbackRes.success) {
        ctxRes = fallbackRes;
        contextPath = 'context.mdc';
      }
    }
    if (!ctxRes.success) {
      throw new Error(ctxRes.error || 'コンテキストの読み込みに失敗しました');
    }
    const mapSection = extractSection(ctxRes.content, '## Context Map', '## ');
    if (!mapSection) return [];
    return parseContextEntriesFromSection(mapSection);
  }

  async function buildDagNodesForRecommendations(entries) {
    const nodes = new Map();
    for (const entry of entries) {
      if (!entry?.path) continue;
      try {
        const res = await window.docs.read(entry.path);
        if (!res.success) continue;
        const bc = extractBreadcrumbs(res.content);
        if (!bc) continue;
        const layer = ((bc.match(/>\s*Layer:\s*(.+)/) || [])[1] || '').trim();
        const upstreamRaw = ((bc.match(/>\s*Upstream:\s*(.+)/) || [])[1] || '').trim();
        const downstreamRaw = ((bc.match(/>\s*Downstream:\s*(.+)/) || [])[1] || '').trim();
        const splitLinks = (raw) => raw
          .split(',')
          .map(s => s.trim())
          .filter(s => s && s.toUpperCase() !== 'N/A');
        nodes.set(entry.path, {
          path: entry.path,
          layer,
          upstream: splitLinks(upstreamRaw),
          downstream: splitLinks(downstreamRaw),
          children: []
        });
      } catch (err) {
        console.warn('[Tasks] Failed to parse breadcrumbs for', entry.path, err);
      }
    }
    return nodes;
  }

  function detectCyclesForRecommendations(nodes) {
    const visited = new Set();
    const recStack = new Set();
    const cycles = [];

    function dfs(path, stack) {
      if (recStack.has(path)) {
        const cycle = [...stack, path];
        cycles.push({ path, cycle, message: `循環参照: ${cycle.join(' → ')}` });
        return;
      }
      if (visited.has(path)) return;
      visited.add(path);
      recStack.add(path);
      stack.push(path);
      const node = nodes.get(path);
      if (node) {
        for (const downPath of node.downstream) {
          dfs(downPath, [...stack]);
        }
      }
      recStack.delete(path);
    }

    for (const [path] of nodes) {
      if (!visited.has(path)) dfs(path, []);
    }
    return cycles;
  }

  function computeGateResultsForRecommendations(nodes) {
    const results = {
      'DOC-01': [],
      'DOC-02': [],
      'DOC-03': [],
      'DOC-04': []
    };
    const validLayers = ['STRATEGY','PRD','UX','API','DATA','ARCH','DEVELOPMENT','QA'];

    for (const [path, node] of nodes) {
      if (!node.layer && !node.upstream.length && !node.downstream.length) {
        results['DOC-01'].push({ path, message: 'Breadcrumbsブロックが見つかりません' });
      }
      if (node.layer && !validLayers.includes(node.layer.toUpperCase())) {
        results['DOC-02'].push({ path, layer: node.layer, message: `無効なLayer: ${node.layer}` });
      }
      for (const upPath of node.upstream) {
        if (!nodes.has(upPath)) {
          results['DOC-03'].push({ path, link: upPath, message: `Upstreamパスが存在しません: ${upPath}` });
        }
      }
      for (const downPath of node.downstream) {
        if (!nodes.has(downPath)) {
          results['DOC-03'].push({ path, link: downPath, message: `Downstreamパスが存在しません: ${downPath}` });
        }
      }
    }

    results['DOC-04'] = detectCyclesForRecommendations(nodes);
    return results;
  }

  function summarizeGateResults(gateResults, nodes) {
    const byPath = new Map();
    const byLayer = new Map();
    let errorCount = 0;
    let warnCount = 0;

    const pushIssue = (path, issue) => {
      if (!path) return;
      if (!byPath.has(path)) {
        byPath.set(path, { path, issues: [] });
      }
      byPath.get(path).issues.push(issue);

      const node = nodes.get(path);
      const layer = node?.layer ? node.layer.toUpperCase() : null;
      if (layer) {
        if (!byLayer.has(layer)) {
          byLayer.set(layer, { layer, issues: [] });
        }
        byLayer.get(layer).issues.push(issue);
      }
    };

    for (const gateId of Object.keys(gateResults || {})) {
      const violations = gateResults[gateId] || [];
      const severity = gateId === 'DOC-04' ? 'warn' : 'error';
      for (const violation of violations) {
        const issue = {
          gateId,
          message: violation.message || '',
          path: violation.path || '',
          severity
        };
        pushIssue(violation.path, issue);
        if (severity === 'error') errorCount += 1;
        else warnCount += 1;
      }
    }

    return {
      byPath,
      byLayer,
      totals: { errorCount, warnCount }
    };
  }

  function computeFeatCoverage(links) {
    const keys = ['PRD','UX','API','DATA','QA'];
    const missing = [];
    for (const key of keys) {
      const value = links?.[key];
      if (!value || !value.trim()) missing.push(key);
    }
    return {
      passed: keys.length - missing.length,
      missing
    };
  }

  function normalizeDocPath(value) {
    if (!value) return '';
    return value.split('#')[0].trim();
  }

  function escapeSelector(value) {
    if (typeof value !== 'string') return '';
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return value.replace(/([ "#%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  async function ensureRecommendationArtifacts({ forceReload = false } = {}) {
    if (forceReload) {
      recommendationAnalysisState.artifacts = null;
      recommendationAnalysisState.loadingPromise = null;
      recommendationAnalysisState.lastError = null;
    }

    if (recommendationAnalysisState.artifacts && !forceReload) {
      return recommendationAnalysisState.artifacts;
    }

    if (recommendationAnalysisState.loadingPromise) {
      return recommendationAnalysisState.loadingPromise;
    }

    const promise = (async () => {
      const entries = await loadContextEntriesForRecommendations();
      const nodes = await buildDagNodesForRecommendations(entries);
      const gateResults = await computeGateResultsForRecommendations(nodes);
      const gateSummary = summarizeGateResults(gateResults, nodes);
      const feats = await loadFeats();
      const artifacts = { entries, nodes, gateResults, gateSummary, feats };
      recommendationAnalysisState.artifacts = artifacts;
      recommendationAnalysisState.lastUpdated = new Date();
      recommendationAnalysisState.lastError = null;
      return artifacts;
    })().catch(err => {
      recommendationAnalysisState.artifacts = null;
      recommendationAnalysisState.lastError = err;
      throw err;
    }).finally(() => {
      recommendationAnalysisState.loadingPromise = null;
    });

    recommendationAnalysisState.loadingPromise = promise;
    return promise;
  }

  function computeTaskRecommendations(taskList, artifacts) {
    if (!Array.isArray(taskList) || !artifacts) return [];
    const results = [];
    const featItems = Array.isArray(artifacts?.feats?.items) ? artifacts.feats.items : [];
    const featMap = new Map();
    for (const item of featItems) {
      if (!item?.id) continue;
      const coverage = computeFeatCoverage(item.links || {});
      const docPaths = Object.values(item.links || {})
        .map(normalizeDocPath)
        .filter(Boolean);
      const issues = [];
      const missingDag = [];
      for (const path of docPaths) {
        if (artifacts.gateSummary.byPath.has(path)) {
          issues.push({ path, issues: artifacts.gateSummary.byPath.get(path).issues });
        }
        if (!artifacts.nodes.has(path)) {
          missingDag.push(path);
        }
      }
      featMap.set(item.id, { item, coverage, docPaths, issues, missingDag });
    }

    const layerGateCounts = new Map();
    artifacts.gateSummary.byLayer.forEach((value, layer) => {
      const errorCount = value.issues.filter(issue => issue.severity === 'error').length;
      const warnCount = value.issues.filter(issue => issue.severity === 'warn').length;
      layerGateCounts.set(layer, { errorCount, warnCount });
    });

    for (const task of taskList) {
      if (!task || typeof task !== 'object') continue;
      const normalizedStatus = (task.status || '').toUpperCase();
      if (['DONE', 'CANCELLED', 'ARCHIVED'].includes(normalizedStatus)) continue;

      const normalizedPriority = (task.priority || '').toUpperCase();
      const normalizedCategory = (task.category || '').toUpperCase();

      let score = 0;
      const reasons = [];
      const priorityWeight = PRIORITY_WEIGHTS[normalizedPriority] ?? 2;
      if (priorityWeight > 0) {
        score += priorityWeight;
        reasons.push(`優先度が${task.priority || '未設定'} (+${priorityWeight})`);
      }

      const statusWeight = STATUS_WEIGHTS[normalizedStatus] || 0;
      if (statusWeight > 0) {
        score += statusWeight;
        const label = normalizedStatus === 'BLOCKED' ? 'ブロック中' : (task.status || '未設定');
        reasons.push(`ステータス: ${label} (+${statusWeight})`);
      }

      let featWeight = 0;
      if (task.featId) {
        const featData = featMap.get(task.featId);
        if (featData) {
          if (featData.coverage.missing.length) {
            const coverageScore = featData.coverage.missing.length * COVERAGE_WEIGHT;
            score += coverageScore;
            featWeight += coverageScore;
            reasons.push(`FEAT ${task.featId} の未リンク: ${featData.coverage.missing.join(', ')} (+${coverageScore})`);
          }
          const gateHighlights = [];
          for (const entry of featData.issues) {
            for (const issue of entry.issues) {
              const weight = issue.severity === 'error' ? GATE_ERROR_WEIGHT : GATE_WARN_WEIGHT;
              score += weight;
              featWeight += weight;
              gateHighlights.push(`${issue.gateId}:${entry.path.split('/').pop()}`);
            }
          }
          if (gateHighlights.length) {
            const text = gateHighlights.slice(0, 3).join(', ');
            reasons.push(`Quality Gate違反: ${text}`);
          }
          if (featData.missingDag.length) {
            const missingScore = featData.missingDag.length * COVERAGE_WEIGHT;
            score += missingScore;
            featWeight += missingScore;
            reasons.push(`DAG未登録ドキュメント: ${featData.missingDag.map(p => p.split('/').pop()).join(', ')}`);
          }
        } else {
          score += COVERAGE_WEIGHT;
          featWeight += COVERAGE_WEIGHT;
          reasons.push(`FEAT ${task.featId} がRegistry未登録 (要確認)`);
        }
      } else if (artifacts.gateSummary.totals.errorCount > 0 && task.category && /DOC|文書|仕様|QA/i.test(task.category)) {
        const docPressure = Math.min(artifacts.gateSummary.totals.errorCount, 5);
        if (docPressure > 0) {
          score += docPressure;
          reasons.push('Quality Gate違反が発生中 (ドキュメント整備を優先)');
        }
      }

      let layerWeight = 0;
      if (normalizedCategory && layerGateCounts.has(normalizedCategory)) {
        const layerSummary = layerGateCounts.get(normalizedCategory);
        const layerScore = (layerSummary.errorCount * LAYER_GATE_WEIGHT)
          + (layerSummary.warnCount * Math.max(1, LAYER_GATE_WEIGHT - 1));
        if (layerScore > 0) {
          score += layerScore;
          layerWeight += layerScore;
          reasons.push(`カテゴリ${task.category}でGate課題 ${layerSummary.errorCount + layerSummary.warnCount}件`);
        }
      }

      if (score <= 0) continue;

      const updatedAt = Date.parse(task.updatedAt || '') || Date.parse(task.createdAt || '') || 0;

      results.push({
        task,
        taskId: task.id,
        title: task.title || '(無題)',
        score: Math.round(score),
        reasons,
        summary: reasons.join(' / '),
        priority: task.priority || '',
        priorityWeight,
        status: task.status || '',
        statusWeight,
        featId: task.featId || '',
        category: task.category || '',
        layerWeight,
        featWeight,
        updatedAt
      });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.priorityWeight !== a.priorityWeight) return b.priorityWeight - a.priorityWeight;
      if (b.statusWeight !== a.statusWeight) return b.statusWeight - a.statusWeight;
      if (b.featWeight !== a.featWeight) return b.featWeight - a.featWeight;
      return a.updatedAt - b.updatedAt;
    });

    return results.slice(0, 5).map((entry, idx) => ({
      ...entry,
      rank: idx + 1
    }));
  }

  function setRecommendationStatus(message) {
    if (!recommendationStatusEl) return;
    recommendationStatusEl.textContent = message || '';
  }

  async function handleRecommendationSelect(rec) {
    if (!rec?.taskId) return;
    selectedTaskId = rec.taskId;
    updateTaskSelection();
    const selector = `li[data-task-id="${escapeSelector(rec.taskId)}"]`;
    const target = listEl ? listEl.querySelector(selector) : null;
    if (target && typeof target.scrollIntoView === 'function') {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { target.scrollIntoView(); }
    }
    await renderDetail(rec.taskId);
    if (window?.tasks?.recordRecommendationSelection) {
      try {
        await window.tasks.recordRecommendationSelection({
          taskId: rec.taskId,
          title: rec.title,
          score: rec.score,
          priority: rec.priority,
          status: rec.status,
          featId: rec.featId,
          rank: rec.rank,
          reason: rec.summary,
          reasons: rec.reasons
        });
      } catch (err) {
        console.warn('[Tasks] Failed to record recommendation selection', err);
      }
    }
  }

  function renderRecommendations(recommendations) {
    if (!recommendationPanel || !recommendationListEl) return;
    recommendationListEl.innerHTML = '';

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      const msg = document.createElement('li');
      msg.className = 'tasks-recommendations__empty';
      msg.textContent = '現在推奨アクションはありません';
      recommendationListEl.appendChild(msg);
      setRecommendationStatus('推奨アクションは現在ありません');
      return;
    }

    const updatedAt = recommendationAnalysisState.lastUpdated
      ? recommendationAnalysisState.lastUpdated.toLocaleString('ja-JP')
      : new Date().toLocaleString('ja-JP');
    setRecommendationStatus(`${recommendations.length}件の推奨アクション (更新: ${updatedAt})`);

    for (const rec of recommendations) {
      const li = document.createElement('li');
      li.className = 'tasks-recommendations__item';

      const body = document.createElement('div');
      body.className = 'tasks-recommendations__body';

      const title = document.createElement('p');
      title.className = 'tasks-recommendations__title';
      title.textContent = `${rec.rank}. ${rec.title}`;
      body.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'tasks-recommendations__meta';
      const parts = [
        `<span class="tasks-recommendations__score">スコア ${rec.score}</span>`,
        `優先度: ${escapeHtml(rec.priority || 'N/A')}`,
        `ステータス: ${escapeHtml(rec.status || 'N/A')}`
      ];
      if (rec.featId) parts.push(`FEAT: ${escapeHtml(rec.featId)}`);
      if (rec.category) parts.push(`カテゴリ: ${escapeHtml(rec.category)}`);
      meta.innerHTML = parts.join(' · ');
      body.appendChild(meta);

      const reason = document.createElement('p');
      reason.className = 'tasks-recommendations__reason';
      reason.textContent = rec.summary || '優先度の高いタスクです';
      body.appendChild(reason);

      li.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'tasks-recommendations__item-actions';
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'btn btn-primary btn-sm';
      jumpBtn.textContent = 'タスクを開く';
      jumpBtn.addEventListener('click', () => { handleRecommendationSelect(rec); });
      actions.appendChild(jumpBtn);
      li.appendChild(actions);

      recommendationListEl.appendChild(li);
    }
  }

  async function runRecommendationRefresh(options = {}) {
    if (!recommendationPanel) return;
    if (recommendationRefreshPromise) {
      recommendationRefreshQueued = true;
      return;
    }

    const { forceReload = false } = options;
    setRecommendationStatus('解析中...');
    recommendationPanel.classList.remove('empty-state');

    recommendationRefreshPromise = (async () => {
      try {
        const artifacts = await ensureRecommendationArtifacts({ forceReload });
        latestRecommendations = computeTaskRecommendations(tasks, artifacts);
        renderRecommendations(latestRecommendations);
      } catch (err) {
        console.warn('[Tasks] Recommendation refresh failed:', err);
        latestRecommendations = [];
        if (recommendationListEl) recommendationListEl.innerHTML = '';
        setRecommendationStatus(`解析に失敗しました: ${(err && err.message) || err}`);
      }
    })().finally(() => {
      recommendationRefreshPromise = null;
      if (recommendationRefreshQueued) {
        recommendationRefreshQueued = false;
        runRecommendationRefresh();
      }
    });
  }

  function scheduleRecommendationRefresh(options = {}) {
    if (!recommendationPanel) return;
    if (options?.forceReload) {
      recommendationAnalysisState.artifacts = null;
      recommendationAnalysisState.loadingPromise = null;
    }
    runRecommendationRefresh(options);
  }

  async function renderPromptDictionaryUI(task) {
    const container = document.getElementById('task-prompt-dictionary');
    if (!container) return;

    await ensurePromptLibraryLoaded();

    if (promptStatusTimer) {
      clearTimeout(promptStatusTimer);
      promptStatusTimer = null;
    }

    currentTaskForPrompts = task || null;
    const initialIds = Array.isArray(task?.promptPartIds)
      ? task.promptPartIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
      : [];
    promptSelection = new Set(initialIds);

    const statusEl = document.getElementById('task-prompt-status');
    const metaEl = document.getElementById('task-prompt-meta');
    const selectedEl = document.getElementById('task-prompt-selected');
    const categorySelect = document.getElementById('task-prompt-category');
    const addCategoryBtn = document.getElementById('task-prompt-add-category');
    const searchInput = document.getElementById('task-prompt-search');
    const itemsEl = document.getElementById('task-prompt-items');
    const itemsEmptyEl = document.getElementById('task-prompt-items-empty');
    const addItemBtn = document.getElementById('task-prompt-add-item');
    const itemIdInput = document.getElementById('task-prompt-item-id');
    const itemTitleInput = document.getElementById('task-prompt-item-title');
    const itemDescriptionInput = document.getElementById('task-prompt-item-description');
    const itemBodyInput = document.getElementById('task-prompt-item-body');
    const itemTagsInput = document.getElementById('task-prompt-item-tags');
    const itemSaveBtn = document.getElementById('task-prompt-item-save');
    const itemDeleteBtn = document.getElementById('task-prompt-item-delete');
    const saveDictionaryBtn = document.getElementById('task-prompt-save-dictionary');

    function updateStatus(message, variant = 'info', autoHide = false) {
      if (!statusEl) return;
      const variantClasses = ['status-info', 'status-success', 'status-error', 'status-warn'];
      statusEl.classList.remove(...variantClasses);
      if (!message) {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
        return;
      }
      statusEl.textContent = message;
      statusEl.classList.remove('hidden');
      statusEl.classList.add(`status-${variant === 'warn' ? 'warn' : variant}`);
      if (promptStatusTimer) {
        clearTimeout(promptStatusTimer);
        promptStatusTimer = null;
      }
      if (autoHide) {
        promptStatusTimer = setTimeout(() => {
          if (statusEl) {
            statusEl.classList.add('hidden');
          }
        }, 2500);
      }
    }

    function syncTaskSelection() {
      if (currentTaskForPrompts) {
        currentTaskForPrompts.promptPartIds = Array.from(promptSelection);
      }
    }

    function pruneSelection() {
      const validIds = collectPromptItemIds();
      let changed = false;
      for (const id of Array.from(promptSelection)) {
        if (!validIds.has(id)) {
          promptSelection.delete(id);
          changed = true;
        }
      }
      if (changed) {
        syncTaskSelection();
      }
    }

    function replacePromptIdAcrossTasks(oldId, newId) {
      if (!oldId || oldId === newId) return;
      if (promptSelection.has(oldId)) {
        promptSelection.delete(oldId);
        promptSelection.add(newId);
      }
      for (const t of tasks) {
        if (Array.isArray(t.promptPartIds)) {
          t.promptPartIds = t.promptPartIds.map(id => (id === oldId ? newId : id));
        }
      }
      syncTaskSelection();
    }

    function updateMeta() {
      if (!metaEl) return;
      const parts = [];
      if (promptLibrary.metadata.description) parts.push(promptLibrary.metadata.description);
      if (promptLibrary.metadata.updatedAt) {
        try {
          const stamp = new Date(promptLibrary.metadata.updatedAt);
          if (!isNaN(stamp.getTime())) {
            parts.push(`最終更新: ${stamp.toLocaleString('ja-JP')}`);
          } else {
            parts.push(`最終更新: ${promptLibrary.metadata.updatedAt}`);
          }
        } catch {
          parts.push(`最終更新: ${promptLibrary.metadata.updatedAt}`);
        }
      }
      if (parts.length) {
        metaEl.textContent = parts.join(' / ');
        metaEl.classList.remove('hidden');
      } else {
        metaEl.textContent = '';
        metaEl.classList.add('hidden');
      }
    }

    function renderSelectedChips() {
      if (!selectedEl) return;
      selectedEl.innerHTML = '';
      if (!promptSelection.size) {
        const empty = document.createElement('p');
        empty.className = 'text-muted';
        empty.textContent = '辞書パーツを選択するとここに表示されます。';
        selectedEl.appendChild(empty);
        return;
      }
      for (const id of promptSelection) {
        const item = findPromptItem(id);
        const pill = document.createElement('span');
        pill.className = 'tasks-meta-pill';
        const label = document.createElement('span');
        label.textContent = item ? `${item.id}: ${item.title}` : `${id} (未定義)`;
        pill.appendChild(label);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-ghost btn-sm';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          promptSelection.delete(id);
          syncTaskSelection();
          renderSelectedChips();
          refreshItemsList();
        });
        pill.appendChild(removeBtn);
        selectedEl.appendChild(pill);
      }
    }

    function updateEditor() {
      if (!itemIdInput || !itemTitleInput || !itemBodyInput || !itemSaveBtn || !itemDeleteBtn || !itemDescriptionInput || !itemTagsInput) return;
      const item = findPromptItem(promptActiveItemId);
      if (!item) {
        itemIdInput.value = '';
        itemTitleInput.value = '';
        itemDescriptionInput.value = '';
        itemBodyInput.value = '';
        itemTagsInput.value = '';
        itemSaveBtn.disabled = true;
        itemDeleteBtn.disabled = true;
        return;
      }
      itemIdInput.value = item.id;
      itemTitleInput.value = item.title;
      itemDescriptionInput.value = item.description || '';
      itemBodyInput.value = item.body || '';
      itemTagsInput.value = item.tags.join(', ');
      itemSaveBtn.disabled = false;
      itemDeleteBtn.disabled = false;
    }

    function refreshCategoryOptions() {
      if (!categorySelect) return;
      categorySelect.innerHTML = '';
      if (!promptLibrary.categories.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '(カテゴリなし)';
        categorySelect.appendChild(option);
        categorySelect.disabled = true;
        if (addItemBtn) addItemBtn.disabled = true;
        promptCategoryId = '';
        return;
      }
      categorySelect.disabled = false;
      if (addItemBtn) addItemBtn.disabled = false;
      if (!promptCategoryId || !findPromptCategory(promptCategoryId)) {
        promptCategoryId = promptLibrary.categories[0].id;
      }
      for (const cat of promptLibrary.categories) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.label || cat.id;
        categorySelect.appendChild(opt);
      }
      categorySelect.value = promptCategoryId;
    }

    function refreshItemsList() {
      if (!itemsEl) return;
      const category = findPromptCategory(promptCategoryId);
      const filtered = category
        ? category.items.filter(item => {
            if (!promptSearchQuery) return true;
            const haystack = `${item.id} ${item.title} ${item.description} ${item.tags.join(' ')} ${item.body}`.toLowerCase();
            return haystack.includes(promptSearchQuery);
          })
        : [];

      itemsEl.innerHTML = '';

      if (!category) {
        if (itemsEmptyEl) {
          itemsEmptyEl.textContent = 'カテゴリを追加してください。';
          itemsEmptyEl.classList.remove('hidden');
        }
        promptActiveItemId = '';
        updateEditor();
        return;
      }

      if (!filtered.length) {
        if (itemsEmptyEl) {
          itemsEmptyEl.textContent = promptSearchQuery ? '一致するプロンプトがありません。' : 'このカテゴリにはプロンプトがありません。';
          itemsEmptyEl.classList.remove('hidden');
        }
        promptActiveItemId = '';
        updateEditor();
        return;
      }

      if (itemsEmptyEl) {
        itemsEmptyEl.classList.add('hidden');
      }

      if (!filtered.some(item => item.id === promptActiveItemId)) {
        promptActiveItemId = filtered[0].id;
      }

      for (const item of filtered) {
        const li = document.createElement('li');
        li.className = 'task-prompts__item';
        if (item.id === promptActiveItemId) {
          li.classList.add('active');
        }
        const label = document.createElement('label');
        label.className = 'task-prompts__item-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = promptSelection.has(item.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            promptSelection.add(item.id);
          } else {
            promptSelection.delete(item.id);
          }
          syncTaskSelection();
          renderSelectedChips();
        });
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${item.id} · ${item.title}`;
        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        li.appendChild(label);
        if (item.description) {
          const desc = document.createElement('div');
          desc.className = 'task-prompts__item-desc';
          desc.textContent = item.description;
          li.appendChild(desc);
        }
        if (item.tags.length) {
          const tags = document.createElement('div');
          tags.className = 'task-prompts__item-tags';
          tags.textContent = item.tags.map(tag => `#${tag}`).join(' ');
          li.appendChild(tags);
        }
        li.addEventListener('click', (ev) => {
          if (ev.target && ev.target.tagName === 'INPUT') return;
          promptActiveItemId = item.id;
          refreshItemsList();
        });
        itemsEl.appendChild(li);
      }

      updateEditor();
    }

    pruneSelection();
    syncTaskSelection();
    renderSelectedChips();
    refreshCategoryOptions();
    refreshItemsList();
    updateMeta();

    if (promptLibraryDirty) {
      updateStatus('未保存の変更があります', 'warn');
    } else {
      updateStatus('', 'info');
    }

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        promptCategoryId = categorySelect.value;
        promptActiveItemId = '';
        refreshItemsList();
      });
    }

    if (searchInput) {
      searchInput.value = promptSearchQuery;
      searchInput.addEventListener('input', () => {
        promptSearchQuery = searchInput.value.trim().toLowerCase();
        refreshItemsList();
      });
    }

    if (addCategoryBtn) {
      addCategoryBtn.addEventListener('click', () => {
        const label = window.prompt('新しいカテゴリ名を入力してください');
        if (!label) return;
        const id = slugifyPromptId(label);
        if (!id) {
          alert('カテゴリIDを生成できませんでした');
          return;
        }
        if (findPromptCategory(id)) {
          alert('同じIDのカテゴリが存在します');
          return;
        }
        promptLibrary.categories.push({ id, label: label.trim(), description: '', items: [] });
        promptCategoryId = id;
        promptActiveItemId = '';
        promptLibraryDirty = true;
        updateStatus('未保存の変更があります', 'warn');
        refreshCategoryOptions();
        refreshItemsList();
      });
    }

    if (addItemBtn) {
      addItemBtn.addEventListener('click', () => {
        if (!promptCategoryId) {
          alert('先にカテゴリを追加してください');
          return;
        }
        const category = findPromptCategory(promptCategoryId);
        if (!category) {
          alert('カテゴリが見つかりません');
          return;
        }
        const newItem = {
          id: generatePromptItemId(promptCategoryId),
          title: '新規プロンプト',
          description: '',
          body: '',
          tags: [],
        };
        category.items.push(newItem);
        promptActiveItemId = newItem.id;
        promptLibraryDirty = true;
        updateStatus('未保存の変更があります', 'warn');
        refreshItemsList();
        renderSelectedChips();
      });
    }

    if (itemSaveBtn) {
      itemSaveBtn.addEventListener('click', () => {
        if (!promptCategoryId) return;
        const category = findPromptCategory(promptCategoryId);
        if (!category) {
          alert('カテゴリが見つかりません');
          return;
        }
        const index = category.items.findIndex(entry => entry.id === promptActiveItemId);
        if (index === -1) {
          alert('編集対象が見つかりません');
          return;
        }
        const entry = category.items[index];
        const newId = (itemIdInput?.value || '').trim();
        if (!newId) {
          alert('IDを入力してください');
          itemIdInput?.focus();
          return;
        }
        if (newId !== entry.id && findPromptItem(newId)) {
          alert('同じIDのアイテムが存在します');
          return;
        }
        const newTitle = (itemTitleInput?.value || '').trim() || newId;
        const newDescription = (itemDescriptionInput?.value || '').trim();
        const newBody = itemBodyInput?.value || '';
        const newTags = (itemTagsInput?.value || '')
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean);
        const oldId = entry.id;
        entry.id = newId;
        entry.title = newTitle;
        entry.description = newDescription;
        entry.body = newBody;
        entry.tags = newTags;
        if (oldId !== newId) {
          replacePromptIdAcrossTasks(oldId, newId);
          promptActiveItemId = newId;
        }
        promptLibraryDirty = true;
        updateStatus('未保存の変更があります', 'warn');
        refreshItemsList();
        renderSelectedChips();
        updateEditor();
      });
    }

    if (itemDeleteBtn) {
      itemDeleteBtn.addEventListener('click', () => {
        if (!promptCategoryId) return;
        const category = findPromptCategory(promptCategoryId);
        if (!category) return;
        const index = category.items.findIndex(entry => entry.id === promptActiveItemId);
        if (index === -1) return;
        const targetId = category.items[index].id;
        if (!window.confirm(`「${targetId}」を削除しますか？`)) return;
        category.items.splice(index, 1);
        if (promptSelection.has(targetId)) {
          promptSelection.delete(targetId);
          syncTaskSelection();
        }
        for (const t of tasks) {
          if (Array.isArray(t.promptPartIds)) {
            t.promptPartIds = t.promptPartIds.filter(id => id !== targetId);
          }
        }
        const fallback = category.items[index] || category.items[index - 1] || null;
        promptActiveItemId = fallback ? fallback.id : '';
        promptLibraryDirty = true;
        updateStatus('未保存の変更があります', 'warn');
        refreshItemsList();
        renderSelectedChips();
      });
    }

    if (saveDictionaryBtn) {
      saveDictionaryBtn.disabled = !(window.prompts && typeof window.prompts.writeJson === 'function');
      saveDictionaryBtn.addEventListener('click', async () => {
        if (!window.prompts || typeof window.prompts.writeJson !== 'function') {
          alert('保存APIが利用できません');
          return;
        }
        try {
          promptLibrary.metadata.updatedAt = new Date().toISOString();
          const payload = JSON.parse(JSON.stringify(promptLibrary));
          const res = await window.prompts.writeJson(payload);
          if (res && res.success) {
            promptLibraryDirty = false;
            updateStatus('prompts.jsonに保存しました', 'success', true);
            updateMeta();
          } else {
            const errorMessage = res?.error || '保存に失敗しました';
            updateStatus(errorMessage, 'error');
            alert(errorMessage);
          }
        } catch (error) {
          console.error('Failed to save prompts.json', error);
          updateStatus('保存に失敗しました', 'error');
          alert('保存に失敗しました');
        }
      });
    } else if (!window.prompts || typeof window.prompts.writeJson !== 'function') {
      updateStatus('prompts APIが利用できません', 'warn');
    }
  }
  function getVisibleTasks() {
    const query = searchQuery;
    return tasks.filter(t => {
      const matchesCategory = selectedTaskCategory ? t.category === selectedTaskCategory : true;
      const haystack = (t.title + ' ' + t.category + ' ' + (t.featId || '')).toLowerCase();
      const matchesQuery = query ? haystack.includes(query) : true;
      return matchesCategory && matchesQuery;
    });
  }

  function updateCategorySelection() {
    catsEl.querySelectorAll('li').forEach(li => {
      li.classList.toggle('active', li.dataset.category === selectedTaskCategory);
    });
  }

  function updateTaskSelection() {
    listEl.querySelectorAll('li').forEach(li => {
      li.classList.toggle('active', li.dataset.taskId === selectedTaskId);
    });
  }

  function renderCategories(items) {
    const cats = new Map();
    for (const t of items) cats.set(t.category, (cats.get(t.category) || 0) + 1);
    catsEl.innerHTML = '';
    if (cats.size === 0) {
      toggleEmpty(catsEmptyEl, true, 'タスクを追加するとカテゴリが表示されます');
      return;
    }
    toggleEmpty(catsEmptyEl, false);
    if (selectedTaskCategory && !cats.has(selectedTaskCategory)) {
      selectedTaskCategory = null;
      persistCategoryValue('');
    }
    for (const [c, n] of Array.from(cats.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const li = document.createElement('li');
      li.dataset.category = c;
      li.textContent = `${c} (${n})`;
      li.setAttribute('role', 'button');
      li.addEventListener('click', () => {
        if (selectedTaskCategory === c) {
          selectedTaskCategory = null;
        } else {
          selectedTaskCategory = c;
          selectedTaskId = null;
        }
        persistCategoryValue(selectedTaskCategory);
        updateCategorySelection();
        renderList();
      });
      catsEl.appendChild(li);
    }
    updateCategorySelection();
  }

  function renderList() {
    const visible = getVisibleTasks();
    listEl.innerHTML = '';
    if (visible.length === 0) {
      const message = tasks.length === 0 ? 'タスクがありません。上のフォームから追加してください。' : '条件に合致するタスクがありません';
      toggleEmpty(listEmptyEl, true, message);
      selectedTaskId = null;
      updateTaskSelection();
      showTaskDetailPlaceholder(tasks.length === 0 ? 'タスクを追加すると編集できます' : '対象のタスクが見つかりませんでした');
      return;
    }
    toggleEmpty(listEmptyEl, false);
    for (const t of visible) {
      const li = document.createElement('li');
      li.dataset.taskId = t.id;
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = t.title || '(無題)';
      li.appendChild(title);
      const meta = document.createElement('span');
      meta.className = 'meta';
      const breakdownMeta = t.breakdownStatus ? ` / BD:${t.breakdownStatus}` : '';
      meta.textContent = `${t.category} / ${t.priority} / ${t.status}${t.featId ? ' / ' + t.featId : ''}${breakdownMeta}`;
      li.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'tasks-actions';
      const breakdownBtn = document.createElement('button');
      breakdownBtn.type = 'button';
      breakdownBtn.className = 'btn btn-secondary btn-sm';
      breakdownBtn.textContent = 'Breakdown';
      breakdownBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectedTaskId = t.id;
        updateTaskSelection();
        await renderDetail(t.id);
        const genBtn = document.getElementById('task-generate-breakdown');
        if (genBtn) {
          genBtn.click();
        }
      });
      actions.appendChild(breakdownBtn);
      li.appendChild(actions);
      li.addEventListener('click', (ev) => {
        ev.preventDefault();
        selectedTaskId = t.id;
        updateTaskSelection();
        renderDetail(t.id);
      });
      listEl.appendChild(li);
    }
    if (!selectedTaskId || !visible.some(t => t.id === selectedTaskId)) {
      selectedTaskId = visible[0].id;
    }
    updateTaskSelection();
    renderDetail(selectedTaskId);
  }
  async function renderDetail(id) {
    const t = tasks.find(x=>x.id===id); if (!t) { showTaskDetailPlaceholder('タスクを選択すると編集できます'); return; }
    const feats = await loadFeats(); const featOpts = [''].concat(feats.items.map(i=>i.id)); const featSuggest = t.featId ? feats.items.find(i=>i.id===t.featId) : null;
    detailEl.classList.remove('empty-state');
    detailEl.innerHTML = `
      <div class="task-detail">
        <header class="task-detail__header">
          <h3 class="task-detail__title">${escapeHtml(t.title || '(無題)')}</h3>
          <div class="task-detail__meta">
            <span class="tasks-meta-pill">カテゴリ: ${escapeHtml(t.category)}</span>
            <span class="tasks-meta-pill">優先度: ${escapeHtml(t.priority)}</span>
            <span class="tasks-meta-pill">ステータス: ${escapeHtml(t.status)}</span>
            ${t.featId ? `<span class="tasks-meta-pill">FEAT: ${escapeHtml(t.featId)}</span>` : ''}
          </div>
        </header>
        <div class="task-detail__body">
          <div class="form-group"><label>タイトル</label><input id="task-title" type="text" value="${escapeHtml(t.title)}"/></div>
          <div class="form-group"><label>カテゴリ</label><input id="task-category" type="text" value="${escapeHtml(t.category)}"/></div>
          <div class="form-group"><label>優先度</label><select id="task-priority"><option ${t.priority==='HIGH'?'selected':''}>HIGH</option><option ${t.priority==='MEDIUM'?'selected':''}>MEDIUM</option><option ${t.priority==='LOW'?'selected':''}>LOW</option></select></div>
          <div class="form-group"><label>ステータス</label><select id="task-status"><option ${t.status==='TODO'?'selected':''}>TODO</option><option ${t.status==='IN_PROGRESS'?'selected':''}>IN_PROGRESS</option><option ${t.status==='DONE'?'selected':''}>DONE</option></select></div>
          <div class="form-group"><label>FEAT-ID</label><select id="task-feat">${featOpts.map(v=>`<option ${t.featId===v?'selected':''}>${v}</option>`).join('')}</select></div>
          <div class="form-group"><label>Notes</label><textarea id="task-notes" rows="4">${escapeHtml(t.notes||'')}</textarea></div>
          <hr/>
          <div class="form-group"><label>Breakdown Prompt</label><div class="control-group"><button id="task-generate-breakdown" class="btn btn-primary">Generate</button><button id="task-copy-breakdown" class="btn btn-secondary">Copy for Cursor auto</button><select id="task-breakdown-status"><option ${t.breakdownStatus==='DRAFT'?'selected':''}>DRAFT</option><option ${t.breakdownStatus==='READY'?'selected':''}>READY</option><option ${t.breakdownStatus==='REVIEWED'?'selected':''}>REVIEWED</option></select><span class="status" id="task-breakdown-stamp">${t.lastBreakdownAt?`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`:''}</span></div><textarea id="task-breakdown-prompt" rows="10" placeholder="Generateで雛形を作成">${escapeHtml(t.breakdownPrompt||'')}</textarea></div>
          <div class="control-group"><button id="task-save" class="btn btn-primary">更新</button>${featSuggest?`<button id="task-open-prd" class="btn btn-secondary">PRD</button>`:''}${featSuggest?`<button id="task-open-ux" class="btn btn-secondary">UX</button>`:''}${featSuggest?`<button id="task-open-api" class="btn btn-secondary">API</button>`:''}${featSuggest?`<button id="task-open-data" class="btn btn-secondary">DATA</button>`:''}${featSuggest?`<button id="task-open-qa" class="btn btn-secondary">QA</button>`:''}</div>
          <hr/>
          <div class="task-prompts" id="task-prompt-dictionary">
            <div class="task-prompts__header">
              <h4>Prompt Dictionary</h4>
              <span class="status hidden" id="task-prompt-status"></span>
            </div>
            <p class="text-muted hidden" id="task-prompt-meta"></p>
            <div class="task-prompts__selected" id="task-prompt-selected"></div>
            <div class="task-prompts__grid">
              <div class="task-prompts__list">
                <div class="form-group">
                  <label>カテゴリ</label>
                  <div class="control-group">
                    <select id="task-prompt-category"></select>
                    <button id="task-prompt-add-category" class="btn btn-secondary btn-sm" type="button">カテゴリ追加</button>
                  </div>
                </div>
                <div class="form-group">
                  <label for="task-prompt-search">検索</label>
                  <input id="task-prompt-search" type="text" placeholder="キーワードで絞り込み" />
                </div>
                <ul id="task-prompt-items" class="task-prompts__items"></ul>
                <p class="task-prompts__empty hidden" id="task-prompt-items-empty"></p>
                <button id="task-prompt-add-item" class="btn btn-secondary btn-sm" type="button">アイテム追加</button>
              </div>
              <div class="task-prompts__editor">
                <div class="form-group">
                  <label for="task-prompt-item-id">ID</label>
                  <input id="task-prompt-item-id" type="text" placeholder="例: TASK-BD-01" />
                </div>
                <div class="form-group">
                  <label for="task-prompt-item-title">タイトル</label>
                  <input id="task-prompt-item-title" type="text" />
                </div>
                <div class="form-group">
                  <label for="task-prompt-item-description">説明</label>
                  <textarea id="task-prompt-item-description" rows="2"></textarea>
                </div>
                <div class="form-group">
                  <label for="task-prompt-item-body">本文</label>
                  <textarea id="task-prompt-item-body" rows="6" placeholder="プロンプト本文を入力"></textarea>
                </div>
                <div class="form-group">
                  <label for="task-prompt-item-tags">タグ（カンマ区切り）</label>
                  <input id="task-prompt-item-tags" type="text" placeholder="MECE,Cursor" />
                </div>
                <div class="task-prompts__actions">
                  <button id="task-prompt-item-save" class="btn btn-primary btn-sm" type="button">エントリ保存</button>
                  <button id="task-prompt-item-delete" class="btn btn-secondary btn-sm" type="button">削除</button>
                </div>
              </div>
            </div>
            <div class="task-prompts__actions">
              <button id="task-prompt-save-dictionary" class="btn btn-secondary btn-sm" type="button">辞書を保存</button>
            </div>
          </div>
        </div>
      </div>`;
    await renderPromptDictionaryUI(t);
    function getPath(v){return v?v.split('#')[0].trim():'';}
    const openBy = async (key)=>{ const p=featSuggest&&getPath(featSuggest.links[key]); if(p) await window.docs.open(p); };
    const saveButton = document.getElementById('task-save');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        t.title = document.getElementById('task-title').value.trim();
        t.category = document.getElementById('task-category').value.trim() || 'Uncategorized';
        t.priority = document.getElementById('task-priority').value;
        t.status = document.getElementById('task-status').value;
        t.featId = document.getElementById('task-feat').value.trim();
        t.notes = document.getElementById('task-notes').value;
        const bdTextarea = document.getElementById('task-breakdown-prompt');
        if (bdTextarea) t.breakdownPrompt = bdTextarea.value;
        const bdStatus = document.getElementById('task-breakdown-status');
        if (bdStatus) t.breakdownStatus = bdStatus.value;
        t.promptPartIds = Array.from(promptSelection);
        t.updatedAt = new Date().toISOString();
        selectedTaskCategory = t.category;
        selectedTaskId = t.id;
        persistCategoryValue(selectedTaskCategory);
        renderCategories(tasks);
        renderList();
        scheduleRecommendationRefresh();
      });
    }
    if (featSuggest) { const map={PRD:'task-open-prd',UX:'task-open-ux',API:'task-open-api',DATA:'task-open-data',QA:'task-open-qa'}; for (const k of Object.keys(map)) { const btn=document.getElementById(map[k]); if(btn) btn.addEventListener('click',()=>openBy(k)); } }
    const genBtn=document.getElementById('task-generate-breakdown'); const copyBtn=document.getElementById('task-copy-breakdown');
    if(genBtn) genBtn.addEventListener('click', async ()=>{ const featId=document.getElementById('task-feat').value.trim(); const reg=await loadFeats(); const item=reg.items.find(i=>i.id===featId); const links=item?item.links:{}; let prompt=buildBreakdownPrompt({ title:document.getElementById('task-title').value.trim(), category:document.getElementById('task-category').value.trim(), priority:document.getElementById('task-priority').value, featId, links }); await ensurePromptLibraryLoaded(); const extraItems=getSelectedPromptItems(); if(extraItems.length){ const blocks=extraItems.map(part=>{ const lines=[]; lines.push(`### ${part.title||part.id}`); if(part.description) lines.push(part.description); if(part.body) lines.push(part.body); if(part.tags&&part.tags.length) lines.push(`タグ: ${part.tags.join(', ')}`); return lines.filter(Boolean).join('\n'); }).filter(Boolean); if(blocks.length){ prompt = [prompt, '', '## 追加プロンプトパーツ', blocks.join('\n\n')].join('\n').replace(/\n{3,}/g,'\n\n').trim(); }} const ta=document.getElementById('task-breakdown-prompt'); if(ta) ta.value=prompt; t.breakdownPrompt=prompt; t.promptPartIds = Array.from(promptSelection); t.lastBreakdownAt=new Date().toISOString(); const stamp=document.getElementById('task-breakdown-stamp'); if(stamp) stamp.textContent=`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`; });
    if(copyBtn) copyBtn.addEventListener('click', async ()=>{ const ta=document.getElementById('task-breakdown-prompt'); const txt=ta?ta.value:''; if(!txt){ alert('Breakdown Promptが空です'); return;} try{ await navigator.clipboard.writeText(txt); alert('コピーしました（Cursor autoに貼り付けてください）'); }catch(e){ alert('クリップボードへのコピーに失敗しました'); } });
  }
  function escapeHtml(s){return String(s||'').replace(/[&<>]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));}
  if (bulkImportBtn) {
    bulkImportBtn.addEventListener('click', () => {
      const text = (bulkTextarea && bulkTextarea.value) || '';
      if (!text.trim()) {
        alert('貼り付け欄が空です');
        return;
      }
      const newOnes = parsePasted(text);
      if (!newOnes.length) {
        alert('取り込み対象がありません');
        return;
      }
      tasks = tasks.concat(newOnes);
      searchQueryRaw = '';
      searchQuery = '';
      persistFilterValue('');
      if (filterInput) filterInput.value = '';
      selectedTaskCategory = newOnes[0].category;
      persistCategoryValue(selectedTaskCategory);
      selectedTaskId = newOnes[0].id;
      renderCategories(tasks);
      renderList();
      scheduleRecommendationRefresh();
      if (bulkTextarea) bulkTextarea.value = '';
      alert(`${newOnes.length}件を取り込みました`);
    });
  }
  if (addOneBtn) {
    addOneBtn.addEventListener('click', () => {
      const cat = (addCatInput && addCatInput.value.trim()) || 'Uncategorized';
      const title = (addTitleInput && addTitleInput.value.trim()) || '';
      if (!title) {
        alert('タイトルを入力してください');
        return;
      }
      const [item] = parsePasted(`【${cat}】 ${title}`);
      tasks.push(item);
      selectedTaskCategory = item.category;
      persistCategoryValue(selectedTaskCategory);
      selectedTaskId = item.id;
      searchQueryRaw = '';
      searchQuery = '';
      persistFilterValue('');
      if (filterInput) filterInput.value = '';
      renderCategories(tasks);
      renderList();
      scheduleRecommendationRefresh();
      if (addTitleInput) addTitleInput.value = '';
    });
  }
  saveBtn.addEventListener('click', async ()=>{ const res=await window.tasks.writeJson(tasks); alert(res.success?'保存しました':`保存失敗: ${res.error}`); });
  exportBtn.addEventListener('click', async ()=>{ const lines=tasks.map(t=>`- [${t.status}] (${t.priority}) ${t.title} ${t.featId? '['+t.featId+']':''} #${t.category}`); const md=lines.join('\n'); const res=await window.tasks.appendMdc('human_todo.mdc', md); alert(res.success?'human_todo.mdcに追記しました':`エクスポート失敗: ${res.error}`); });
  if (recommendationRefreshBtn) {
    recommendationRefreshBtn.addEventListener('click', () => {
      scheduleRecommendationRefresh({ forceReload: true });
    });
  }
  if (filterInput) filterInput.addEventListener('input', ()=>{ const raw=filterInput.value.trim(); searchQueryRaw=raw; searchQuery=raw.toLowerCase(); persistFilterValue(raw); renderList(); });
  (async ()=>{ const res=await window.tasks.readJson(); tasks=res.success&&Array.isArray(res.data)?res.data.map(applyTaskDefaults):[]; if(tasks.length){ selectedTaskId=tasks[0].id; } renderCategories(tasks); renderList(); scheduleRecommendationRefresh({ forceReload: true }); })();
})();

