// Ported Tasks (import/edit/save/export/breakdown)
(function initTasksModule() {
  function taskDefaults() {
    return {
      notes: '',
      breakdownPrompt: '',
      breakdownStatus: 'DRAFT',
      lastBreakdownAt: '',
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
        </div>
      </div>`;
    function getPath(v){return v?v.split('#')[0].trim():'';}
    const openBy = async (key)=>{ const p=featSuggest&&getPath(featSuggest.links[key]); if(p) await window.docs.open(p); };
    document.getElementById('task-save').addEventListener('click', ()=>{ t.title=document.getElementById('task-title').value.trim(); t.category=document.getElementById('task-category').value.trim()||'Uncategorized'; t.priority=document.getElementById('task-priority').value; t.status=document.getElementById('task-status').value; t.featId=document.getElementById('task-feat').value.trim(); t.notes=document.getElementById('task-notes').value; const bdTextarea=document.getElementById('task-breakdown-prompt'); if(bdTextarea) t.breakdownPrompt=bdTextarea.value; const bdStatus=document.getElementById('task-breakdown-status'); if(bdStatus) t.breakdownStatus=bdStatus.value; t.updatedAt=new Date().toISOString(); selectedTaskCategory = t.category; selectedTaskId = t.id; renderCategories(tasks); renderList(); });
    if (featSuggest) { const map={PRD:'task-open-prd',UX:'task-open-ux',API:'task-open-api',DATA:'task-open-data',QA:'task-open-qa'}; for (const k of Object.keys(map)) { const btn=document.getElementById(map[k]); if(btn) btn.addEventListener('click',()=>openBy(k)); } }
    const genBtn=document.getElementById('task-generate-breakdown'); const copyBtn=document.getElementById('task-copy-breakdown');
    if(genBtn) genBtn.addEventListener('click', async ()=>{ const featId=document.getElementById('task-feat').value.trim(); const reg=await loadFeats(); const item=reg.items.find(i=>i.id===featId); const links=item?item.links:{}; const prompt=buildBreakdownPrompt({ title:document.getElementById('task-title').value.trim(), category:document.getElementById('task-category').value.trim(), priority:document.getElementById('task-priority').value, featId, links }); const ta=document.getElementById('task-breakdown-prompt'); if(ta) ta.value=prompt; t.breakdownPrompt=prompt; t.lastBreakdownAt=new Date().toISOString(); const stamp=document.getElementById('task-breakdown-stamp'); if(stamp) stamp.textContent=`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`; });
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

