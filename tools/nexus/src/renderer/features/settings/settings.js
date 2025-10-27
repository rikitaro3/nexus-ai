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

  if (!rootInput || !saveBtn || !testBtn) {
    return;
  }

  const PROJECT_ROOT_KEY = 'project-root';
  const CONTEXT_FILE_KEY = 'context-file-path';

  function setStatus(el, text, type) {
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.remove('status-ok', 'status-error');
    if (type === 'ok') {
      el.classList.add('status-ok');
    } else if (type === 'error') {
      el.classList.add('status-error');
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
        setStatus(contextStatusEl, 'Context file updated', 'ok');
      } else {
        setStatus(contextStatusEl, 'キャンセルしました', '');
      }
    } catch (e) {
      console.error('[Settings] Failed to select context file:', e);
      setStatus(contextStatusEl, '選択に失敗しました', 'error');
    }
  }

  function handleClearContext() {
    localStorage.removeItem(CONTEXT_FILE_KEY);
    renderContextPath();
    setStatus(contextStatusEl, 'Cleared', 'ok');
  }

  saveBtn.addEventListener('click', handleSave);
  testBtn.addEventListener('click', handleTest);
  if (selectContextBtn) selectContextBtn.addEventListener('click', handleSelectContext);
  if (clearContextBtn) clearContextBtn.addEventListener('click', handleClearContext);

  renderContextPath();
  loadInitialRoot();
})();
