(function initSettings() {
  const rootInput = document.getElementById('settings-project-root');
  const saveBtn = document.getElementById('settings-save-root');
  const testBtn = document.getElementById('settings-test-root');
  const statusEl = document.getElementById('settings-project-root-status');
  const resultsEl = document.getElementById('settings-test-results');
  const contextPathEl = document.getElementById('settings-context-path');
  const contextStatusEl = document.getElementById('settings-context-status');
  const selectContextBtn = document.getElementById('settings-select-context');
  const clearContextBtn = document.getElementById('settings-clear-context');
  const providerSelect = document.getElementById('settings-ai-provider');
  const providerStatusEl = document.getElementById('settings-ai-provider-status');
  const providerDescriptionEl = document.getElementById('settings-ai-provider-description');
  const aiRegistry = window.aiProviderRegistry;

  if (!rootInput || !saveBtn || !testBtn) {
    return;
  }

  const PROJECT_ROOT_KEY = 'project-root';
  const CONTEXT_FILE_KEY = 'context-file-path';
  const AI_PROVIDER_KEY = 'ai-provider';

  function setStatus(el, text, type) {
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.remove('status-ok', 'status-error', 'status-info');
    if (type === 'ok') {
      el.classList.add('status-ok');
    } else if (type === 'error') {
      el.classList.add('status-error');
    } else if (type === 'info') {
      el.classList.add('status-info');
    }
  }

  function renderContextPath() {
    if (!contextPathEl) return;
    const path = localStorage.getItem(CONTEXT_FILE_KEY);
    contextPathEl.textContent = path || '(未設定)';
  }

  async function loadInitialRoot() {
    try {
      const stored = localStorage.getItem(PROJECT_ROOT_KEY);
      if (stored) {
        rootInput.value = stored;
        return;
      }
      const res = await window.settings.getProjectRoot();
      if (res && res.root) {
        rootInput.value = res.root;
      }
    } catch (e) {
      console.error('[Settings] Failed to load project root:', e);
    }
  }

  async function handleSave() {
    const root = rootInput.value.trim();
    if (!root) {
      setStatus(statusEl, 'Path is required', 'error');
      return;
    }
    try {
      await window.settings.setProjectRoot(root);
      localStorage.setItem(PROJECT_ROOT_KEY, root);
      setStatus(statusEl, 'Saved. 再起動で適用されます。', 'ok');
    } catch (e) {
      console.error('[Settings] Failed to save project root:', e);
      setStatus(statusEl, '保存に失敗しました', 'error');
    }
  }

  async function handleTest() {
    const root = rootInput.value.trim();
    if (!root) {
      setStatus(statusEl, 'Path is required', 'error');
      return;
    }
    setStatus(statusEl, 'Testing...', '');
    resultsEl.innerHTML = '';
    try {
      const res = await window.settings.testProjectRoot(root);
      if (!res || !res.success) {
        const msg = res && res.error ? res.error : 'テストに失敗しました';
        setStatus(statusEl, msg, 'error');
        return;
      }
      setStatus(statusEl, `OK: ${res.root}`, 'ok');
      const list = document.createElement('ul');
      list.className = 'settings-test-list';
      for (const [rel, ok] of Object.entries(res.results || {})) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="settings-test-icon ${ok ? 'ok' : 'ng'}">${ok ? '✓' : '✗'}</span>${rel}`;
        list.appendChild(li);
      }
      if (res.missing && res.missing.length > 0) {
        const warn = document.createElement('p');
        warn.className = 'settings-test-warning';
        warn.textContent = `不足ファイル: ${res.missing.join(', ')}`;
        resultsEl.appendChild(warn);
      }
      resultsEl.appendChild(list);
    } catch (e) {
      console.error('[Settings] Failed to test project root:', e);
      setStatus(statusEl, 'テストに失敗しました', 'error');
    }
  }

  async function handleSelectContext() {
    try {
      const res = await window.dialog.selectContextFile();
      if (res && !res.canceled && res.filePath) {
        localStorage.setItem(CONTEXT_FILE_KEY, res.filePath);
        renderContextPath();
        let message = 'Context file updated';
        try {
          if (window.rulesWatcher && typeof window.rulesWatcher.setContextPath === 'function') {
            await window.rulesWatcher.setContextPath(res.filePath);
          }
        } catch (err) {
          console.warn('[Settings] Failed to propagate context to Quality Gates:', err);
          message = 'Context updated (Quality Gates連携に失敗しました)';
          setStatus(contextStatusEl, message, 'info');
          return;
        }
        setStatus(contextStatusEl, message, 'ok');
      } else {
        setStatus(contextStatusEl, 'キャンセルしました', '');
      }
    } catch (e) {
      console.error('[Settings] Failed to select context file:', e);
      setStatus(contextStatusEl, '選択に失敗しました', 'error');
    }
  }

  async function handleClearContext() {
    localStorage.removeItem(CONTEXT_FILE_KEY);
    renderContextPath();
    try {
      if (window.rulesWatcher && typeof window.rulesWatcher.setContextPath === 'function') {
        await window.rulesWatcher.setContextPath(null);
      }
      setStatus(contextStatusEl, 'Cleared', 'ok');
    } catch (err) {
      console.warn('[Settings] Failed to clear Quality Gates context:', err);
      setStatus(contextStatusEl, 'Cleared (Quality Gates連携に失敗しました)', 'info');
    }
  }

  function refreshProviderDescription(provider) {
    if (!providerDescriptionEl) return;
    if (!provider) {
      providerDescriptionEl.textContent = '利用可能なAIプロバイダーが見つかりません。';
      return;
    }
    const description = provider.description && provider.description.trim()
      ? provider.description.trim()
      : `${provider.label} を使用します。`;
    providerDescriptionEl.textContent = description;
  }

  function renderProviderOptions(selectedId) {
    if (!providerSelect) return [];
    const providers = aiRegistry && typeof aiRegistry.listProviders === 'function'
      ? aiRegistry.listProviders()
      : [];
    providerSelect.innerHTML = '';
    if (!providers.length) {
      providerSelect.disabled = true;
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（未登録）';
      providerSelect.appendChild(opt);
      refreshProviderDescription(null);
      return providers;
    }
    providerSelect.disabled = false;
    for (const provider of providers) {
      const opt = document.createElement('option');
      opt.value = provider.id;
      opt.textContent = provider.label || provider.id;
      providerSelect.appendChild(opt);
    }
    if (selectedId && providers.some(p => p.id === selectedId)) {
      providerSelect.value = selectedId;
    } else {
      providerSelect.value = providers[0].id;
    }
    const current = providers.find(p => p.id === providerSelect.value) || null;
    refreshProviderDescription(current);
    return providers;
  }

  async function loadAiProviderSelection() {
    if (!providerSelect) return;
    try {
      const storedLocal = localStorage.getItem(AI_PROVIDER_KEY);
      const providers = renderProviderOptions(storedLocal || undefined);
      if (!providers.length) {
        setStatus(providerStatusEl, 'AIプロバイダーが登録されていません。', 'info');
        return;
      }

      let providerId = storedLocal;
      if (!providerId) {
        const response = await window.settings.getAiProvider();
        providerId = (response && (response.providerId || response.id || response.value)) || '';
      }

      if (!providerId || !providers.some(p => p.id === providerId)) {
        const active = aiRegistry && typeof aiRegistry.getActiveProviderId === 'function'
          ? aiRegistry.getActiveProviderId()
          : '';
        if (active && providers.some(p => p.id === active)) {
          providerId = active;
        } else {
          providerId = providers[0].id;
        }
      }

      providerSelect.value = providerId;
      const provider = providers.find(p => p.id === providerId) || null;
      refreshProviderDescription(provider);

      if (aiRegistry && typeof aiRegistry.setActiveProvider === 'function') {
        aiRegistry.setActiveProvider(providerId, { silent: false });
      }

      await window.settings.setAiProvider(providerId);
      localStorage.setItem(AI_PROVIDER_KEY, providerId);
      setStatus(providerStatusEl, `Provider set to ${provider ? provider.label : providerId}`, 'ok');
    } catch (err) {
      console.error('[Settings] Failed to initialize AI provider:', err);
      setStatus(providerStatusEl, 'AIプロバイダーの初期化に失敗しました', 'error');
    }
  }

  function bindProviderSelect() {
    if (!providerSelect) return;
    providerSelect.addEventListener('change', async () => {
      const providerId = providerSelect.value;
      if (!providerId) {
        setStatus(providerStatusEl, '無効なプロバイダーです', 'error');
        return;
      }
      try {
        if (aiRegistry && typeof aiRegistry.setActiveProvider === 'function') {
          aiRegistry.setActiveProvider(providerId, { silent: false });
        }
        await window.settings.setAiProvider(providerId);
        localStorage.setItem(AI_PROVIDER_KEY, providerId);
        const providers = aiRegistry && typeof aiRegistry.listProviders === 'function'
          ? aiRegistry.listProviders()
          : [];
        const provider = providers.find(p => p.id === providerId) || null;
        refreshProviderDescription(provider);
        setStatus(providerStatusEl, `Provider set to ${provider ? provider.label : providerId}`, 'ok');
      } catch (err) {
        console.error('[Settings] Failed to set AI provider:', err);
        setStatus(providerStatusEl, '更新に失敗しました', 'error');
      }
    });

    if (aiRegistry && typeof aiRegistry.subscribe === 'function') {
      aiRegistry.subscribe(provider => {
        if (!providerSelect) return;
        const currentProviders = renderProviderOptions(provider?.id || providerSelect.value);
        if (!currentProviders.length) return;
        const activeId = provider?.id || providerSelect.value;
        if (activeId) {
          providerSelect.value = activeId;
          const activeProvider = currentProviders.find(p => p.id === activeId) || null;
          refreshProviderDescription(activeProvider);
        }
      });
    }
  }

  saveBtn.addEventListener('click', handleSave);
  testBtn.addEventListener('click', handleTest);
  if (selectContextBtn) selectContextBtn.addEventListener('click', handleSelectContext);
  if (clearContextBtn) clearContextBtn.addEventListener('click', handleClearContext);

  renderContextPath();
  loadInitialRoot();
  bindProviderSelect();
  loadAiProviderSelection();
})();
