// Ported Tasks (import/edit/save/export/breakdown)
(function initTasksModule() {
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

  function buildBreakdownPrompt({ title, category, priority, featId, links }) {
    const linksText = Object.entries(links || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    return [
      'あなたはプロジェクトの実装ブレークダウン設計者です。以下の制約と入力を踏まえ、MECEなサブタスク（各項目に完了基準付き）を5〜10件で提案し、不明点（最大5件）と参照先（PRD/UX/API/DATA/QA）も挙げてください。',
      '',
      '[制約]',
      '- 外部AI APIを使わない（Cursor autoのみ）',
      '- 冗長禁止、簡潔さ重視',
      '- DAG/MECE/Quality Gatesを尊重（context.mdc参照）',
      '',
      '[入力]',
      `- タスク: ${title} / カテゴリ: ${category} / 優先度: ${priority} / FEAT: ${featId || ''}`,
      '- 関連ドキュメント:',
      linksText || '- (なし)',
      '',
      '[出力]',
      '- サブタスク一覧: [ {name, acceptanceCriteria, refs} ... ]',
      '- 不明点: [question1..]',
      '- 参照: [PRD/UX/API/DATA/QAの相対パスとアンカー]'
    ].join('\n');
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
      buildBreakdownPrompt,
    };
  }

  if (typeof document === 'undefined') {
    return;
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

  if (!listEl || !catsEl || !detailEl) return;

  let tasks = [];
  let searchQuery = '';
  let selectedTaskCategory = null;
  let selectedTaskId = null;
  let featsRegistry = null;

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
    const query = searchQuery ? searchQuery.toLowerCase() : '';
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
    document.getElementById('task-save').addEventListener('click', ()=>{ t.title=document.getElementById('task-title').value.trim(); t.category=document.getElementById('task-category').value.trim()||'Uncategorized'; t.priority=document.getElementById('task-priority').value; t.status=document.getElementById('task-status').value; t.featId=document.getElementById('task-feat').value.trim(); t.notes=document.getElementById('task-notes').value; const bdTextarea=document.getElementById('task-breakdown-prompt'); if(bdTextarea) t.breakdownPrompt=bdTextarea.value; const bdStatus=document.getElementById('task-breakdown-status'); if(bdStatus) t.breakdownStatus=bdStatus.value; t.promptPartIds = Array.from(promptSelection); t.updatedAt=new Date().toISOString(); selectedTaskCategory = t.category; selectedTaskId = t.id; renderCategories(tasks); renderList(); });
    if (featSuggest) { const map={PRD:'task-open-prd',UX:'task-open-ux',API:'task-open-api',DATA:'task-open-data',QA:'task-open-qa'}; for (const k of Object.keys(map)) { const btn=document.getElementById(map[k]); if(btn) btn.addEventListener('click',()=>openBy(k)); } }
    const genBtn=document.getElementById('task-generate-breakdown'); const copyBtn=document.getElementById('task-copy-breakdown');
    if(genBtn) genBtn.addEventListener('click', async ()=>{ const featId=document.getElementById('task-feat').value.trim(); const reg=await loadFeats(); const item=reg.items.find(i=>i.id===featId); const links=item?item.links:{}; let prompt=buildBreakdownPrompt({ title:document.getElementById('task-title').value.trim(), category:document.getElementById('task-category').value.trim(), priority:document.getElementById('task-priority').value, featId, links }); await ensurePromptLibraryLoaded(); const extraItems=getSelectedPromptItems(); if(extraItems.length){ const blocks=extraItems.map(part=>{ const lines=[]; lines.push(`### ${part.title||part.id}`); if(part.description) lines.push(part.description); if(part.body) lines.push(part.body); if(part.tags&&part.tags.length) lines.push(`タグ: ${part.tags.join(', ')}`); return lines.filter(Boolean).join('\n'); }).filter(Boolean); if(blocks.length){ prompt = [prompt, '', '## 追加プロンプトパーツ', blocks.join('\n\n')].join('\n').replace(/\n{3,}/g,'\n\n').trim(); }} const ta=document.getElementById('task-breakdown-prompt'); if(ta) ta.value=prompt; t.breakdownPrompt=prompt; t.promptPartIds = Array.from(promptSelection); t.lastBreakdownAt=new Date().toISOString(); const stamp=document.getElementById('task-breakdown-stamp'); if(stamp) stamp.textContent=`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`; });
    if(copyBtn) copyBtn.addEventListener('click', async ()=>{ const ta=document.getElementById('task-breakdown-prompt'); const txt=ta?ta.value:''; if(!txt){ alert('Breakdown Promptが空です'); return;} try{ await navigator.clipboard.writeText(txt); alert('コピーしました（Cursor autoに貼り付けてください）'); }catch(e){ alert('クリップボードへのコピーに失敗しました'); } });
  }
  function escapeHtml(s){return String(s||'').replace(/[&<>]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));}
  if (bulkImportBtn) bulkImportBtn.addEventListener('click', ()=>{ const text=(bulkTextarea&&bulkTextarea.value)||''; if(!text.trim()){alert('貼り付け欄が空です'); return;} const newOnes=parsePasted(text); if(!newOnes.length){ alert('取り込み対象がありません'); return;} tasks=tasks.concat(newOnes); searchQuery=''; if(filterInput) filterInput.value=''; selectedTaskCategory=newOnes[0].category; selectedTaskId=newOnes[0].id; renderCategories(tasks); renderList(); bulkTextarea.value=''; alert(`${newOnes.length}件を取り込みました`); });
  if (addOneBtn) addOneBtn.addEventListener('click', ()=>{ const cat=(addCatInput&&addCatInput.value.trim())||'Uncategorized'; const title=(addTitleInput&&addTitleInput.value.trim())||''; if(!title){alert('タイトルを入力してください'); return;} const [item]=parsePasted(`【${cat}】 ${title}`); tasks.push(item); selectedTaskCategory=item.category; selectedTaskId=item.id; searchQuery=''; if(filterInput) filterInput.value=''; renderCategories(tasks); renderList(); if(addTitleInput) addTitleInput.value=''; });
  saveBtn.addEventListener('click', async ()=>{ const res=await window.tasks.writeJson(tasks); alert(res.success?'保存しました':`保存失敗: ${res.error}`); });
  exportBtn.addEventListener('click', async ()=>{ const lines=tasks.map(t=>`- [${t.status}] (${t.priority}) ${t.title} ${t.featId? '['+t.featId+']':''} #${t.category}`); const md=lines.join('\n'); const res=await window.tasks.appendMdc('human_todo.mdc', md); alert(res.success?'human_todo.mdcに追記しました':`エクスポート失敗: ${res.error}`); });
  filterInput.addEventListener('input', ()=>{ searchQuery=filterInput.value.trim().toLowerCase(); renderList(); });
  (async ()=>{ const res=await window.tasks.readJson(); tasks=res.success&&Array.isArray(res.data)?res.data.map(applyTaskDefaults):[]; if(tasks.length){ selectedTaskId=tasks[0].id; } renderCategories(tasks); renderList(); })();
})();

