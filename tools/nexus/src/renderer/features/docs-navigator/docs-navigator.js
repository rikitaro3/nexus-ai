// Ported Docs Navigator (Docs/FEATs/Orphans)
(async function initDocsNavigator() {
  const expandedPaths = new Set();
  console.log('[Docs Navigator] === INIT START ===');
  const catEl = document.getElementById('docs-categories');
  const listEl = document.getElementById('docs-list');
  const detailEl = document.getElementById('docs-detail');
  const modeButtons = document.querySelectorAll('.docs-mode-btn');
  const modeDescription = document.getElementById('docs-mode-description');
  const catEmptyEl = document.getElementById('docs-categories-empty');
  const listEmptyEl = document.getElementById('docs-list-empty');
  const featListEmptyEl = document.getElementById('feats-list-empty');
  const featDetailEl = document.getElementById('feat-detail');
  const treeStatusEl = document.getElementById('tree-status');
  const treeDetailPanel = document.getElementById('tree-detail');
  const gateResultsPanel = document.getElementById('gate-results');
  let currentGateResults = null;
  const DOC_GATES = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08'];
  const GATE_ORDER = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08', 'TC-01', 'TC-02', 'TC-03', 'TC-04'];
  const GATE_SEVERITY = {
    'DOC-01': 'error',
    'DOC-02': 'error',
    'DOC-03': 'error',
    'DOC-04': 'warn',
    'DOC-05': 'error',
    'DOC-06': 'error',
    'DOC-07': 'error',
    'DOC-08': 'warn',
    'TC-01': 'error',
    'TC-02': 'warn',
    'TC-03': 'warn',
    'TC-04': 'error'
  };
  const modeDescriptions = {
    docs: 'カテゴリからドキュメントを探索します',
    feats: 'FEATのカバレッジと関連ドキュメントを確認します',
    tree: 'Breadcrumbsからリンク構造を検証します'
  };
  let selectedCategory = null;
  let selectedDocPath = null;
  console.log('[Docs Navigator] Basic elements - catEl:', !!catEl, 'listEl:', !!listEl, 'detailEl:', !!detailEl);
  console.log('[Docs Navigator] modeButtons count:', modeButtons.length);

  function toggleEmptyState(el, show, message) {
    if (!el) return;
    if (typeof message === 'string') el.textContent = message;
    el.classList.toggle('hidden', !show);
  }

  function showDocDetailPlaceholder(message) {
    if (!detailEl) return;
    detailEl.classList.add('empty-state');
    detailEl.textContent = message;
  }

  function setTreeStatus(text, tone = 'info') {
    if (!treeStatusEl) return;
    treeStatusEl.textContent = text;
    treeStatusEl.className = `status status-${tone}`;
  }

  if (!catEl || !listEl || !detailEl) {
    console.error('[Docs Navigator] Required elements not found!');
    window.docsNavigatorReady = true;
    return;
  }

  // context source (repo or nexus). default repo unless debug & previously saved
  let contextPath = '.cursor/context.mdc';
  let entries = [];
  let ctx = '';
  let categoryOrder = [];
  let traceSection = '';
  let waypointsSection = '';
  let meceSection = '';
  let contextLoaded = false;
  try {
    const dbg = await window.env.isDebug();
    const isDebug = dbg && dbg.success && dbg.isDebug;
    const wrap = document.getElementById('context-select-wrap');
    const select = document.getElementById('context-select');
    
    // 優先順位: カスタムパス（localStorage） > 環境変数 > デフォルト
    const customContextPath = localStorage.getItem('context-file-path');

    // E2Eテスト時はデフォルトでnexusコンテキストを使用
    const saved = localStorage.getItem('nexus.context');
    let contextToUse = saved || (isDebug ? 'nexus' : 'repo');
    
    if (customContextPath) {
      // カスタムパスが設定されている場合は絶対パスを使用
      contextPath = customContextPath;
      console.log('[Docs Navigator] Using custom context path:', contextPath);
    } else if (isDebug && wrap && select) {
      wrap.style.display = '';
      select.value = contextToUse;
      // Use absolute path from project root
      contextPath = contextToUse === 'nexus' ? 'tools/nexus/context.mdc' : '.cursor/context.mdc';
      select.addEventListener('change', () => {
        const v = select.value;
        localStorage.setItem('nexus.context', v);
        location.reload();
      });
    } else {
      // デバッグモードでない場合でも、localStorageから読み込む
      contextPath = contextToUse === 'nexus' ? 'tools/nexus/context.mdc' : '.cursor/context.mdc';
    }
    console.log('[Docs Navigator] Reading context from:', contextPath);
    console.log('[Docs Navigator] contextToUse:', contextToUse, 'isDebug:', isDebug, 'saved:', saved);
    let ctxRes = await window.docs.read(contextPath);
    if (!ctxRes.success && contextPath !== 'tools/nexus/context.mdc' && !customContextPath) {
      console.warn('[Docs Navigator] Context read failed, trying Nexus fallback...', ctxRes.error);
      const fallbackPath = 'tools/nexus/context.mdc';
      const fallbackRes = await window.docs.read(fallbackPath);
      if (fallbackRes.success) {
        console.log('[Docs Navigator] Fallback context loaded from Nexus package');
        ctxRes = fallbackRes;
        contextPath = fallbackPath;
        contextToUse = 'nexus';
        try {
          localStorage.setItem('nexus.context', 'nexus');
        } catch (err) {
          console.warn('[Docs Navigator] Failed to persist fallback context selection:', err);
        }
      } else {
        console.error('[Docs Navigator] Fallback context failed:', fallbackRes.error);
      }
    }

    if (!ctxRes.success) {
      console.error('[Docs Navigator] Failed to read context:', ctxRes.error);
      console.error('[Docs Navigator] contextPath:', contextPath);
      console.error('[Docs Navigator] Full error:', JSON.stringify(ctxRes));
      // エラー時でも続行する（fallback）
      console.warn('[Docs Navigator] Using empty entries as fallback');
      entries = [];
      window.entries = entries;
      // UIの初期化は続行
      catEl.innerHTML = '<li>コンテキスト読み込み失敗: ' + ctxRes.error + '</li>';
      console.log('[Docs Navigator] Initialization with empty entries');
    } else {
      contextLoaded = true;
      ctx = ctxRes.content;
      console.log('[Docs Navigator] Context loaded, size:', ctx.length);
      console.log('[Docs Navigator] Context content preview:', ctx.substring(0, 200));
      const mapSection = extractSection(ctx, '## Context Map', '## ');
      console.log('[Docs Navigator] Map section found:', !!mapSection, 'length:', mapSection?.length || 0);
      entries = [];
      window.entries = entries;
      categoryOrder = [];
      if (mapSection) {
        const lines = mapSection.split('\n');
        let currentCat = null;
        for (const line of lines) {
          const catMatch = line.match(/^###\s+(.+)$/);
          if (catMatch) { currentCat = catMatch[1].trim(); if (!categoryOrder.includes(currentCat)) categoryOrder.push(currentCat); continue; }
          const itemMatch = line.match(/^\-\s+([^\s].*?)\s+…\s+(.*)$/);
          if (itemMatch && currentCat) entries.push({ category: currentCat, path: itemMatch[1].trim(), desc: itemMatch[2].trim() });
        }
        console.log('[Docs Navigator] Parsed entries:', entries.length, 'categories:', categoryOrder);
      } else {
        console.warn('[Docs Navigator] Map section not found in context');
      }

      traceSection = extractSection(ctx, '## Traceability Map', '## ');
      waypointsSection = extractSection(ctx, '### Waypoints', '### ');
      meceSection = extractSection(ctx, '### MECE Domains', '### ');
    }

    const registry = await parseFeaturesRegistry();
    let filteredFeats = registry.items;

    if (contextLoaded) {
      catEl.innerHTML = '';
    }
    for (const cat of categoryOrder) {
      const li = document.createElement('li');
      li.textContent = cat;
      li.dataset.category = cat;
      li.setAttribute('role', 'button');
      li.addEventListener('click', () => renderList(cat));
      catEl.appendChild(li);
    }
    toggleEmptyState(catEmptyEl, categoryOrder.length === 0, 'カテゴリが見つかりません');

    const orphanTitle = document.createElement('h3');
    orphanTitle.textContent = 'Orphans';
    const orphanList = document.createElement('ul');
    orphanList.id = 'docs-orphans';
    catEl.parentElement.appendChild(orphanTitle);
    catEl.parentElement.appendChild(orphanList);

    let orphanMap = await detectOrphans(entries);
    renderOrphans(orphanMap);

    function updateCategorySelection() {
      catEl.querySelectorAll('li').forEach(li => {
        li.classList.toggle('active', li.dataset.category === selectedCategory);
      });
    }

    function updateDocSelection() {
      listEl.querySelectorAll('li').forEach(li => {
        li.classList.toggle('active', li.dataset.path === selectedDocPath);
      });
    }

    function setActiveDoc(entry) {
      if (!entry) {
        selectedDocPath = null;
        showDocDetailPlaceholder('ドキュメントが見つかりませんでした');
        updateDocSelection();
        return;
      }
      selectedDocPath = entry.path;
      updateDocSelection();
      renderDetail(entry);
    }

    function renderList(cat) {
      selectedCategory = cat;
      updateCategorySelection();
      listEl.innerHTML = '';
      const filtered = entries.filter(e => e.category === cat);
      if (filtered.length === 0) {
        toggleEmptyState(listEmptyEl, true, 'このカテゴリのドキュメントはまだ登録されていません');
        setActiveDoc(null);
        return;
      }
      toggleEmptyState(listEmptyEl, false);
      for (const e of filtered) {
        const li = document.createElement('li');
        li.dataset.path = e.path;
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = e.path;
        a.addEventListener('click', async (ev) => { ev.preventDefault(); setActiveDoc(e); });
        li.appendChild(a);
        const span = document.createElement('span');
        span.textContent = e.desc;
        li.appendChild(span);
        listEl.appendChild(li);
      }
      const initial = filtered.find(e => e.path === selectedDocPath) || filtered[0];
      setActiveDoc(initial);
    }

    async function renderDetail(entry) {
      if (!detailEl) return;
      let breadcrumbsHtml = '';
      let orphanBadge = '';
      try {
        if (entry.path.endsWith('index.mdc')) {
          const res = await window.docs.read(entry.path);
          if (res.success) {
            const bc = extractBreadcrumbs(res.content);
            if (bc) breadcrumbsHtml = `<section class="doc-detail__section"><h4>Breadcrumbs</h4><pre>${escapeHtml(bc)}</pre></section>`;
            const isOrphan = orphanMap.get(entry.path) === true;
            orphanBadge = `<span class="status ${isOrphan ? 'status-warn' : 'status-success'}">${isOrphan ? 'Orphan' : 'Linked'}</span>`;
          }
        }
      } catch (err) {
        console.warn('[Docs Navigator] Breadcrumb parse failed:', err);
      }

      detailEl.classList.remove('empty-state');
      detailEl.innerHTML = `
        <article class="doc-detail">
          <header class="doc-detail__header">
            <span class="doc-detail__path">${escapeHtml(entry.path)}</span>
            ${orphanBadge}
          </header>
          <p class="doc-detail__summary">${escapeHtml(entry.desc)}</p>
          ${breadcrumbsHtml}
          <div class="doc-detail__actions">
            <button id="open-doc" class="btn btn-primary">このドキュメントを開く</button>
            <button id="open-gates" class="btn btn-secondary">Quality Gates 定義を開く</button>
          </div>
          <section class="doc-detail__section">
            <h4>Traceability Map</h4>
            <pre>${escapeHtml(traceSection || '(not found)')}</pre>
          </section>
          <section class="doc-detail__section">
            <h4>Waypoints</h4>
            <pre>${escapeHtml(waypointsSection || '(not found)')}</pre>
          </section>
          <section class="doc-detail__section">
            <h4>MECE Domains</h4>
            <pre>${escapeHtml(meceSection || '(not found)')}</pre>
          </section>
        </article>`;

      document.getElementById('open-doc')?.addEventListener('click', async () => { await window.docs.open(entry.path); });
      document.getElementById('open-gates')?.addEventListener('click', async () => { await window.docs.open('.cursor/gates.traceability.mdc'); });
    }

    const docsMode = document.getElementById('docs-mode-docs');
    const featsMode = document.getElementById('docs-mode-feats');
    const treeMode = document.getElementById('docs-mode-tree');
    window.treeView = document.getElementById('tree-view');
    const treeView = window.treeView;
    const treeDetail = treeDetailPanel;
    window.treeDetail = treeDetail;
    window.treeDirection = document.getElementById('tree-direction');
    const treeDirection = window.treeDirection;
    const featSearch = document.getElementById('feat-search');
    
    console.log('[Docs Navigator] Initializing mode buttons...', modeButtons.length);
    console.log('[Docs Navigator] Tree elements - treeMode:', !!treeMode, 'treeView:', !!window.treeView, 'treeDirection:', !!treeDirection);

    modeButtons.forEach((btn, idx) => {
      console.log(`[Docs Navigator] Registering listener for button ${idx}:`, btn.dataset.mode);
      btn.addEventListener('click', () => {
        console.log('[Mode Button Click] Button clicked, mode:', btn.dataset.mode);
        modeButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const mode = btn.dataset.mode;
        if (modeDescription) {
          modeDescription.textContent = modeDescriptions[mode] || '';
        }
        console.log('[Mode Switch] Switching to mode:', mode);
        docsMode.classList.toggle('active', mode === 'docs');
        featsMode.classList.toggle('active', mode === 'feats');
        treeMode.classList.toggle('active', mode === 'tree');
        console.log('[Mode Switch] Classes applied - docs:', docsMode.classList.contains('active'),
                    'feats:', featsMode.classList.contains('active'),
                    'tree:', treeMode.classList.contains('active'));
        if (mode === 'tree') {
          console.log('[Mode Switch] Tree mode activated, calling renderTree()');
          setTreeStatus('Tree構造を解析中...', 'info');
          renderTree();
        }
      });
    });
    console.log('[Docs Navigator] Mode buttons initialized');

    if (treeDirection) {
      treeDirection.addEventListener('change', () => {
        setTreeStatus('Tree構造を解析中...', 'info');
        renderTree();
      });
    }

    document.getElementById('tree-validate')?.addEventListener('click', () => {
      setTreeStatus('Quality Gatesを検証中...', 'info');
      renderTree();
    });

    if (featSearch) {
      featSearch.addEventListener('input', () => {
        const q = featSearch.value.trim().toLowerCase();
        filteredFeats = registry.items.filter(it => it.id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q));
        renderFeatList(filteredFeats, registry.dupIds);
      });
    }
    
    renderFeatList(filteredFeats, registry.dupIds);
    setTreeStatus('モードをTreeに切り替えてください', 'info');
    if (categoryOrder.length > 0) renderList(categoryOrder[0]);
    else showDocDetailPlaceholder('カテゴリがありません');
  } catch (error) { console.error('Docs Navigator init error:', error); }

  function extractSection(text, startHeader, stopHeaderPrefix = '## ') {
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
  function extractBreadcrumbs(text) { const m = text.match(/>\s*Breadcrumbs[\s\S]*?(?=\n#|\n##|$)/); return m ? m[0] : ''; }
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])); }
  async function parseFeaturesRegistry() {
    const out = { items: [], dupIds: [] }; const res = await window.docs.read('docs/PRD/index.mdc'); if (!res.success) return out; const text = res.content; const sec = extractSection(text, '## Features Registry', '## '); if (!sec) return out; const lines = sec.split('\n'); let current = null; const seen = new Set(); const dup = new Set(); for (const raw of lines) { const line = raw.trim(); const head = line.match(/^\-\s*(FEAT-\d{4}):\s*(.+)$/); if (head) { const id = head[1]; const title = head[2]; if (seen.has(id)) dup.add(id); else seen.add(id); current = { id, title, links: {} }; out.items.push(current); continue; } if (!current) continue; const link = line.match(/^\-\s*(PRD|UX|API|DATA|QA):\s*(.+)$/); if (link) { current.links[link[1]] = link[2]; } } out.dupIds = Array.from(dup); return out;
  }
  function renderFeatList(items, dupIds) {
    const featsList = document.getElementById('feats-list');
    const featDupAlert = document.getElementById('feat-dup-alert');
    if (!featsList) return;
    featsList.innerHTML = '';
    toggleEmptyState(featListEmptyEl, items.length === 0, '該当するFEATがありません');
    if (items.length === 0 && featDetailEl) {
      featDetailEl.classList.add('empty-state');
      featDetailEl.textContent = '該当するFEATがありません';
    }
    if (dupIds && dupIds.length > 0) {
      if (featDupAlert) {
        featDupAlert.style.display = '';
        featDupAlert.textContent = `重複ID: ${dupIds.join(', ')}`;
        featDupAlert.className = 'status status-warn';
      }
    } else if (featDupAlert) {
      featDupAlert.style.display = 'none';
    }
    for (const it of items) { const coverage = computeCoverage(it.links); const li = document.createElement('li'); const a = document.createElement('a'); a.href = '#'; a.textContent = `${it.id} — ${it.title} (${coverage.passed}/5)`; a.addEventListener('click', (ev) => { ev.preventDefault(); renderFeatDetail(it, coverage); }); li.appendChild(a); featsList.appendChild(li); }
    if (items.length > 0) renderFeatDetail(items[0], computeCoverage(items[0].links));
  }
  function computeCoverage(links) { const keys = ['PRD','UX','API','DATA','QA']; let passed = 0; const missing = []; for (const k of keys) { if (links[k] && links[k].trim()) passed++; else missing.push(k); } return { passed, missing }; }
  async function renderFeatDetail(feat, coverage) {
    const detail = featDetailEl || document.getElementById('feat-detail');
    if (!detail) return;
    const rows = [];
    for (const k of ['PRD', 'UX', 'API', 'DATA', 'QA']) {
      const val = feat.links[k] || '';
      const path = val.split('#')[0].trim();
      const openBtn = path ? `<button data-open="${escapeHtml(path)}" class="btn btn-sm btn-secondary">Open</button>` : '';
      rows.push(`<tr><td>${k}</td><td>${escapeHtml(val || '(missing)')}</td><td>${openBtn}</td></tr>`);
    }
    const statusBadge = coverage.missing.length
      ? `<span class="status status-warn">不足: ${coverage.missing.join(', ')}</span>`
      : `<span class="status status-success">全てカバー済み</span>`;
    detail.classList.remove('empty-state');
    detail.innerHTML = `
      <article class="doc-detail">
        <header class="doc-detail__header">
          <span class="doc-detail__path">${escapeHtml(feat.id)}</span>
          ${statusBadge}
        </header>
        <p class="doc-detail__summary">${escapeHtml(feat.title)}</p>
        <section class="doc-detail__section">
          <h4>Coverage Links</h4>
          <table><thead><tr><th>Layer</th><th>Link</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>
        </section>
      </article>`;
    detail.querySelectorAll('button[data-open]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rel = btn.getAttribute('data-open');
        if (rel) await window.docs.open(rel);
      });
    });
  }
  async function detectOrphans(entries) {
    const map = new Map(); const indexEntries = entries.filter(e => /(^|\/)docs\/.+\/index\.mdc$/.test(e.path)); for (const e of indexEntries) { try { const res = await window.docs.read(e.path); if (!res.success) { map.set(e.path, true); continue; } const bc = extractBreadcrumbs(res.content); if (!bc) { map.set(e.path, true); continue; } const up = (bc.match(/>\s*Upstream:\s*(.*)/) || [])[1] || ''; const down = (bc.match(/>\s*Downstream:\s*(.*)/) || [])[1] || ''; const isEmpty = (v) => !v || v.trim() === '' || v.trim().toUpperCase() === 'N/A'; map.set(e.path, isEmpty(up) && isEmpty(down)); } catch { map.set(e.path, true); } } return map;
  }
  function renderOrphans(orphanMap) { const list = document.getElementById('docs-orphans'); if (!list) return; list.innerHTML = ''; const orphans = Array.from(orphanMap.entries()).filter(([, v]) => v).map(([k]) => k).sort(); const title = list.previousElementSibling; if (title && title.tagName === 'H3') { title.textContent = `Orphans (${orphans.length})`; } for (const p of orphans) { const li = document.createElement('li'); const a = document.createElement('a'); a.href = '#'; a.textContent = p; a.addEventListener('click', (ev) => { ev.preventDefault(); const entry = { path: p, desc: '(Orphan candidate)' }; (async () => { await renderDetail(entry); })(); }); li.appendChild(a); list.appendChild(li); } }

  async function parseAllBreadcrumbs() {
    console.log('[parseAllBreadcrumbs] === START ===');
    const nodes = new Map();
    const docStatus = new Map();
    const docContents = new Map();
    const entriesData = window.entries || [];
    console.log('[parseAllBreadcrumbs] Processing entries:', entriesData.length);
    for (const entry of entriesData) {
      console.log('[parseAllBreadcrumbs] Processing:', entry.path);
      try {
        const res = await window.docs.read(entry.path);
        if (!res.success) {
          console.log('[parseAllBreadcrumbs] Failed to read:', entry.path, res.error);
          docStatus.set(entry.path, { status: 'read-error', message: res.error });
          continue;
        }
        docContents.set(entry.path, res.content);
        const bc = extractBreadcrumbs(res.content);
        if (!bc) {
          console.log('[parseAllBreadcrumbs] No breadcrumbs in:', entry.path);
          docStatus.set(entry.path, { status: 'missing-breadcrumbs' });
          continue;
        }
        const layer = (bc.match(/>\s*Layer:\s*(.+)/) || [])[1] || '';
        const upRaw = (bc.match(/>\s*Upstream:\s*(.+)/) || [])[1] || '';
        const downRaw = (bc.match(/>\s*Downstream:\s*(.+)/) || [])[1] || '';
        const upstream = upRaw.split(',').map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'N/A');
        const downstream = downRaw.split(',').map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'N/A');
        console.log('[parseAllBreadcrumbs] Extracted - path:', entry.path, 'layer:', layer, 'upstream:', upstream, 'downstream:', downstream);
        nodes.set(entry.path, { path: entry.path, layer, upstream, downstream, children: [], expanded: false, content: res.content });
        if (!layer && upstream.length === 0 && downstream.length === 0) {
          docStatus.set(entry.path, { status: 'missing-breadcrumbs' });
        } else {
          docStatus.set(entry.path, { status: 'ok' });
        }
      } catch (e) {
        console.warn('[parseAllBreadcrumbs] Failed to parse:', entry.path, e);
        docStatus.set(entry.path, { status: 'read-error', message: e?.message });
      }
    }
    console.log('[parseAllBreadcrumbs] === COMPLETE === nodes:', nodes.size);
    return { nodes, docStatus, docContents };
  }

  function buildTree(nodes, direction) {
    const visited = new Set();
    const rootNodes = [];
    for (const [, node] of nodes) {
      const isRoot = direction === 'downstream' ? (node.upstream.length === 0) : (node.downstream.length === 0);
      if (isRoot) { rootNodes.push(node); buildTreeRecursive(node, nodes, direction, visited, 0); }
    }
    return rootNodes;
  }

  function buildTreeRecursive(node, nodes, direction, visited, depth) {
    if (depth > 20 || visited.has(node.path)) { return; }
    visited.add(node.path);
    const links = direction === 'downstream' ? node.downstream : node.upstream;
    for (const link of links) {
      const child = nodes.get(link);
      if (child && !visited.has(child.path)) {
        node.children.push(child);
        buildTreeRecursive(child, nodes, direction, visited, depth + 1);
      }
    }
  }

  async function renderTreeNodeDetail(node) {
    const detailPanel = window.treeDetail || treeDetailPanel;
    if (!detailPanel) return;
    detailPanel.classList.remove('empty-state');

    const upstreamLinks = node.upstream.map(path => {
      return `<li><a href="#" data-path="${escapeHtml(path)}" class="doc-link">${escapeHtml(path)}</a></li>`;
    }).join('');
    
    const downstreamLinks = node.downstream.map(path => {
      return `<li><a href="#" data-path="${escapeHtml(path)}" class="doc-link">${escapeHtml(path)}</a></li>`;
    }).join('');
    
    const childrenLinks = node.children.map(child => {
      return `<li><a href="#" data-path="${escapeHtml(child.path)}" class="doc-link">${escapeHtml(child.path)}</a></li>`;
    }).join('');
    
    // Try to find FEAT-ID from document content
    let featId = null;
    let relatedDocs = {};
    try {
      const res = await window.docs.read(node.path);
      if (res.success) {
        // Extract FEAT-ID from content
        const featMatch = res.content.match(/FEAT-(\d{4})/);
        if (featMatch) {
          featId = featMatch[0];
          // Load features registry
          const featRes = await parseFeaturesRegistry();
          if (featRes && featRes.items) {
            const feat = featRes.items.find(item => item.id === featId);
            if (feat && feat.links) {
              relatedDocs = feat.links;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load FEAT info:', e);
    }
    
    let breadcrumbsHtml = '';
    try {
      const res = await window.docs.read(node.path);
      if (res.success && typeof extractBreadcrumbs === 'function') {
        const bc = extractBreadcrumbs(res.content);
        if (bc) {
          breadcrumbsHtml = `<hr/><h4>Breadcrumbs</h4><pre>${escapeHtml(bc)}</pre>`;
        }
      }
    } catch (e) {
      console.warn('Failed to read document for breadcrumbs:', e);
    }
    
    const relatedDocLinks = Object.entries(relatedDocs).map(([key, path]) => {
      return `<button class="btn btn-secondary feat-doc-link" data-path="${escapeHtml(path)}">${key}</button>`;
    }).join(' ');

    let gateSectionHtml = '';
    if (currentGateResults) {
      const gateItems = [];
      for (const gateId of DOC_GATES) {
        const violations = (currentGateResults[gateId] || []).filter(v => v.path === node.path);
        if (!violations.length) continue;
        const defaultSeverity = GATE_SEVERITY[gateId] || 'error';
        const hasError = violations.some(v => (v.severity || defaultSeverity) === 'error');
        const severityClass = hasError ? 'error' : 'warn';
        const violationItems = violations.map(v => {
          const lineLabel = v.line ? ` <span class="gate-line">L${v.line}</span>` : '';
          return `<li>${escapeHtml(v.message)}${lineLabel}</li>`;
        }).join('');
        gateItems.push(`<li class="gate-detail-${severityClass}"><strong>${gateId}</strong><ul>${violationItems}</ul></li>`);
      }
      if (gateItems.length > 0) {
        gateSectionHtml = `
          <section class="doc-detail__section">
            <h4>Gate Violations</h4>
            <ul class="gate-detail-list">${gateItems.join('')}</ul>
          </section>
        `;
      }
    }

    detailPanel.innerHTML = `
      <div>
        <h4>${escapeHtml(node.path)}</h4>
        <p><strong>Layer:</strong> ${escapeHtml(node.layer || 'N/A')}</p>
        ${featId ? `<p><strong>FEAT-ID:</strong> ${escapeHtml(featId)}</p>` : ''}
        <div class="control-group">
          <button id="tree-detail-open" class="btn btn-primary">このドキュメントを開く</button>
        </div>
        ${relatedDocLinks ? `<div class="control-group"><h4>関連ドキュメント</h4>${relatedDocLinks}</div>` : ''}
        <hr/>
        <h4>Upstream（上位リンク）</h4>
        <ul>${upstreamLinks || '<li>なし</li>'}</ul>
        <h4>Downstream（下位リンク）</h4>
        <ul>${downstreamLinks || '<li>なし</li>'}</ul>
        <h4>Children（子ノード）</h4>
        <ul>${childrenLinks || '<li>なし</li>'}</ul>
        ${gateSectionHtml}
        ${breadcrumbsHtml}
      </div>
    `;
    
    // Add event listeners
    document.getElementById('tree-detail-open')?.addEventListener('click', async () => {
      await window.docs.open(node.path);
    });
    
    // Related document links
    detailPanel.querySelectorAll('.feat-doc-link').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.getAttribute('data-path');
        if (path) {
          await window.docs.open(path);
        }
      });
    });
    
    detailPanel.querySelectorAll('.doc-link').forEach(link => {
      link.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const path = ev.target.getAttribute('data-path');
        if (path) {
          await window.docs.open(path);
        }
      });
    });
  }

  function renderTreeNode(node, depth, entriesMap, gateResults) {
    console.log('renderTreeNode called with entriesMap:', entriesMap?.length);
    const div = document.createElement('div');
    div.className = 'tree-node';
    const hasChildren = node.children.length > 0;
    const indent = '  '.repeat(depth);
    const toggle = hasChildren ? (node.expanded ? '▼' : '▶') : '';
    div.innerHTML = `
      <div class="tree-node-content">
        <span class="tree-toggle">${indent}<span class="tree-icon">${toggle}</span></span>
        <span>${node.layer}</span>
        <span class="tree-path">${node.path.split('/').pop()}</span>
      </div>
    `;
    
    if (gateResults) addGateIconToNode(div, node.path, gateResults);
    
    div.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (hasChildren) {
        const isExpanded = expandedPaths.has(node.path);
        if (isExpanded) {
          expandedPaths.delete(node.path);
        } else {
          expandedPaths.add(node.path);
        }
        node.expanded = !isExpanded;
      }
      await renderTreeNodeDetail(node);
      renderTree();
    });
    const container = document.createElement('div');
    container.appendChild(div);
    if (hasChildren && node.expanded) {
      for (const child of node.children) {
        container.appendChild(renderTreeNode(child, depth + 1, entriesMap, gateResults));
      }
    }
    return container;
  }

  async function validateGates(nodes, docStatus, docContents) {
    const results = {};
    for (const gateId of GATE_ORDER) {
      results[gateId] = [];
    }

    for (const [path, status] of docStatus.entries()) {
      if (status.status === 'missing-breadcrumbs') {
        results['DOC-01'].push({ path, message: 'Breadcrumbsブロックが見つかりません', severity: 'error' });
      } else if (status.status === 'read-error') {
        results['DOC-01'].push({ path, message: `ドキュメントを読み込めません: ${status.message}`, severity: 'error' });
      }
    }

    const validLayers = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
    for (const [path, node] of nodes) {
      if (node.layer && !validLayers.includes(node.layer.toUpperCase())) {
        results['DOC-02'].push({ path, layer: node.layer, message: `無効なLayer: ${node.layer}`, severity: 'error' });
      }
      for (const upPath of node.upstream) {
        if (!nodes.has(upPath)) {
          results['DOC-03'].push({ path, link: upPath, message: `Upstreamパスが存在しません: ${upPath}`, severity: 'error' });
        }
      }
      for (const downPath of node.downstream) {
        if (!nodes.has(downPath)) {
          results['DOC-03'].push({ path, link: downPath, message: `Downstreamパスが存在しません: ${downPath}`, severity: 'error' });
        }
      }
    }

    const cycles = detectCycles(nodes);
    results['DOC-04'] = cycles.map(cycle => ({ ...cycle, severity: 'warn' }));

    for (const [path, content] of docContents.entries()) {
      const analysis = analyzeHeadingsUi(path, content);
      if (analysis.violations.length) {
        results['DOC-05'].push(...analysis.violations);
      }

      const tocViolations = validateTableOfContentsUi(path, content, analysis);
      if (tocViolations.length) {
        results['DOC-06'].push(...tocViolations);
      }

      const namingViolations = validateFileNamingUi(path, nodes.get(path));
      if (namingViolations.length) {
        results['DOC-07'].push(...namingViolations);
      }

      const scopeViolations = validateScopeSectionsUi(path, content, analysis);
      if (scopeViolations.length) {
        results['DOC-08'].push(...scopeViolations);
      }
    }

    const { cases, errors } = await loadTestCasesUi();
    for (const err of errors) {
      results['TC-01'].push({ path: err.path, message: err.message, severity: 'error' });
    }

    const tcResults = validateTestCasesUi(cases);
    for (const gateId of ['TC-01', 'TC-02', 'TC-03', 'TC-04']) {
      if (tcResults[gateId]?.length) {
        results[gateId].push(...tcResults[gateId]);
      }
    }

    return results;
  }

  function analyzeHeadingsUi(path, content) {
    const lines = content.split('\n');
    const headingsRaw = [];
    const headingRegex = /^(#{2,6})\s+(.+)$/;
    for (let i = 0; i < lines.length; i++) {
      const match = headingRegex.exec(lines[i]);
      if (!match) continue;
      const level = match[1].length;
      const rest = match[2].trim();
      const numberMatch = rest.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.*)$/);
      let numbers = null;
      let title = rest;
      if (numberMatch) {
        numbers = numberMatch[1].split('.').map(v => Number(v));
        title = numberMatch[2] || '';
      }
      headingsRaw.push({
        level,
        line: i + 1,
        rest,
        title,
        numbers,
        hasNumbering: Boolean(numbers && numbers.every(n => Number.isFinite(n)))
      });
    }

    const hasNumbering = headingsRaw.some(h => h.hasNumbering && h.level <= 3);
    const headings = headingsRaw.map(heading => ({
      path,
      line: heading.line,
      level: heading.level,
      title: heading.title,
      numbers: heading.hasNumbering ? heading.numbers : null,
      hasNumbering: heading.hasNumbering,
      anchorKey: heading.hasNumbering ? sanitizeKey(`${heading.numbers.join('-')}-${heading.title}`) : sanitizeKey(heading.title)
    }));

    return { headings, violations: [], applicable: hasNumbering };
  }

  function validateTableOfContentsUi(path, content, analysis) {
    if (!analysis.applicable) return [];
    const tocSection = extractSection(content, '## 目次', '## ');
    if (!tocSection) return [];

    const linkRegex = /\[(.+?)\]\(#([^)]+)\)/g;
    const links = [];
    let match;
    while ((match = linkRegex.exec(tocSection)) !== null) {
      links.push(match[0]);
    }

    if (!links.length) {
      return [{ path, message: '目次にリンクが定義されていません', severity: 'error' }];
    }

    return [];
  }

  function validateFileNamingUi(path, node) {
    const violations = [];
    if (!node) return violations;
    const segments = path.split('/');
    const fileName = segments[segments.length - 1] || path;
    if (fileName.toLowerCase() === 'index.mdc') return violations;

    const lastDot = fileName.lastIndexOf('.');
    const ext = lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
    const layer = node.layer ? node.layer.toUpperCase() : null;

    if (!ext) {
      violations.push({ path, message: '拡張子が存在しません', severity: 'error' });
    } else if (ext !== '.mdc' && !(layer === 'ARCH' && ext === '.md')) {
      violations.push({ path, message: `無効な拡張子: ${ext}`, severity: 'error' });
    }

    if (/\s/.test(fileName)) {
      violations.push({ path, message: 'ファイル名に空白が含まれています', severity: 'error' });
    }

    const allowedPattern = /^[\p{L}\p{N}_\-\.]+$/u;
    if (!allowedPattern.test(fileName)) {
      violations.push({ path, message: 'ファイル名に使用できない文字が含まれています', severity: 'error' });
    }

    if (layer === 'PRD' && ext !== '.mdc') {
      violations.push({ path, message: 'PRD層のドキュメントは.mdc拡張子を使用してください', severity: 'error' });
    }

    if (layer === 'QA' && ext !== '.mdc') {
      violations.push({ path, message: 'QA層のドキュメントは.mdc拡張子を使用してください', severity: 'error' });
    }

    return violations;
  }

  function validateScopeSectionsUi(path, content, analysis) {
    if (!analysis.applicable) return [];
    const sections = [
      { label: '扱う内容', regex: /^##+\s*(扱う内容|Scope)\s*$/m },
      { label: '扱わない内容', regex: /^##+\s*(扱わない内容|Out of Scope)\s*$/m }
    ];

    const violations = [];
    for (const section of sections) {
      const match = section.regex.exec(content);
      if (!match) continue;
      const startIndex = match.index + match[0].length;
      const rest = content.slice(startIndex);
      const nextSectionMatch = rest.match(/\n##\s+/);
      const block = nextSectionMatch ? rest.slice(0, nextSectionMatch.index) : rest;
      const hasList = /(^|\n)\s*[-\*]\s+/.test(block);
      const hasText = block.trim().length > 0;
      if (!hasList || !hasText) {
        violations.push({ path, message: `${section.label} セクションの内容が不足しています`, severity: 'warn' });
      }
    }
    return violations;
  }

  async function loadTestCasesUi() {
    try {
      const manifestRes = await window.docs.read('test/test-cases.json');
      let specFiles = [];
      if (manifestRes.success) {
        try {
          const parsed = JSON.parse(manifestRes.content);
          if (Array.isArray(parsed.specFiles)) {
            specFiles = parsed.specFiles.filter(p => typeof p === 'string');
          }
        } catch (error) {
          console.warn('[validateGates] Failed to parse test-cases.json:', error);
        }
      }

      const cases = [];
      const errors = [];
      for (const specPath of specFiles) {
        const res = await window.docs.read(specPath);
        if (res.success) {
          cases.push({ path: specPath, content: res.content });
        } else {
          errors.push({ path: specPath, message: res.error || '読み込み失敗' });
        }
      }
      return { cases, errors };
    } catch (error) {
      console.warn('[validateGates] loadTestCasesUi failed:', error);
      return { cases: [], errors: [] };
    }
  }

  function validateTestCasesUi(testCases) {
    const results = {
      'TC-01': [],
      'TC-02': [],
      'TC-03': [],
      'TC-04': []
    };
    const namePattern = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/;
    const dependencyPatterns = [
      /(test|it)\([^)]*\)\s*\.then/si,
      /afterEach[\s\S]*?(test|it)\(/si
    ];

    for (const testCase of testCases) {
      const fileName = testCase.path.split('/').pop() || testCase.path;
      if (!namePattern.test(fileName.toLowerCase())) {
        results['TC-01'].push({ path: testCase.path, message: 'ファイル名が `[分類]-[機能]-[シナリオ].spec.ts` 形式に一致しません', severity: 'error' });
      }

      for (const pattern of dependencyPatterns) {
        if (pattern.test(testCase.content)) {
          results['TC-02'].push({ path: testCase.path, message: 'テストケース間の依存関係が検出されました', severity: 'warn' });
          break;
        }
      }

      const tests = (testCase.content.match(/\b(test|it)\s*\(/g) || []).length;
      if (tests > 0) {
        const documented = (testCase.content.match(/\/\*\*[\s\S]*?目的[\s\S]*?期待結果[\s\S]*?\*\//g) || []).length;
        const coverage = Math.round((documented / tests) * 100);
        if (coverage < 80) {
          results['TC-03'].push({ path: testCase.path, message: `テストドキュメント化率が不足しています (${coverage}% < 80%)`, severity: 'warn' });
        }
      }

      const hasFixture = /fixtures\//.test(testCase.content);
      const hasSetup = /(beforeAll|test\.beforeAll)/.test(testCase.content);
      const hasTeardown = /(afterAll|test\.afterAll)/.test(testCase.content);
      if (!hasFixture || !hasSetup || !hasTeardown) {
        const missing = [];
        if (!hasFixture) missing.push('fixtures参照');
        if (!hasSetup) missing.push('beforeAll');
        if (!hasTeardown) missing.push('afterAll');
        results['TC-04'].push({ path: testCase.path, message: `テストデータ管理が不十分です (${missing.join(', ')})`, severity: 'error' });
      }
    }

    return results;
  }

  function sanitizeKey(value) {
    return (value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9一-龠ぁ-んァ-ヶー]/g, '');
  }

  function detectCycles(nodes) {
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

  function renderGateResults(results) {
    const panel = gateResultsPanel || document.getElementById('gate-results');
    if (!panel) return;
    panel.classList.remove('empty-state');
    panel.innerHTML = '';

    for (const gateId of GATE_ORDER) {
      const violations = results[gateId] || [];
      const defaultSeverity = GATE_SEVERITY[gateId] || 'error';
      const hasError = violations.some(v => (v.severity || defaultSeverity) === 'error');
      const hasViolations = violations.length > 0;
      const status = hasViolations ? (hasError ? 'error' : 'warn') : 'pass';
      const statusText = hasViolations
        ? (hasError ? `✗ ${violations.length} issue(s)` : `⚠ ${violations.length} warning(s)`)
        : '✓ PASS';

      const gateDiv = document.createElement('div');
      gateDiv.className = `gate-result ${status}`;
      gateDiv.innerHTML = `<strong>${gateId}</strong>: ${statusText}`;

      if (violations.length > 0) {
        for (const v of violations) {
          const vDiv = document.createElement('div');
          vDiv.className = 'gate-violation';
          const lineLabel = v.line ? `<span class="gate-line">L${v.line}</span>` : '';
          vDiv.innerHTML = `
            <div>${escapeHtml(v.path)} ${lineLabel}</div>
            <div style="font-size:12px;color:#6b7280;">${escapeHtml(v.message)}</div>
            <div class="gate-actions">
              <button class="btn btn-sm btn-secondary" data-action="open" data-path="${escapeHtml(v.path)}">Open</button>
              <button class="btn btn-sm btn-secondary" data-action="fix" data-gate="${gateId}" data-path="${escapeHtml(v.path)}">Fix Prompt</button>
            </div>
          `;
          gateDiv.appendChild(vDiv);
        }
      }
      panel.appendChild(gateDiv);
    }

    panel.querySelectorAll('button[data-action="open"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.getAttribute('data-path');
        await window.docs.open(path);
      });
    });
    
    panel.querySelectorAll('button[data-action="fix"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gate = btn.getAttribute('data-gate');
        const path = btn.getAttribute('data-path');
        generateFixPrompt(gate, path);
      });
    });
  }

  function generateFixPrompt(gateId, path) {
    const prompts = {
      'DOC-01': `以下のドキュメントにBreadcrumbsブロックを追加してください。\n\nファイル: ${path}\n\nフォーマット:\n> Breadcrumbs\n> Layer: [STRATEGY|PRD|UX|API|DATA|ARCH|DEVELOPMENT|QA]\n> Upstream: [上位ドキュメントパス or N/A]\n> Downstream: [下位ドキュメントパス or N/A]`,
      'DOC-02': `以下のドキュメントのLayerを修正してください。\n\nファイル: ${path}\n\n有効なLayer: STRATEGY, PRD, UX, API, DATA, ARCH, DEVELOPMENT, QA`,
      'DOC-03': `以下のドキュメントのUpstream/Downstreamパスを修正してください。\n\nファイル: ${path}\n\n存在しないパスを削除または修正してください。`,
      'DOC-04': `以下のドキュメントで循環参照を解消してください。\n\nファイル: ${path}\n\nUpstream/Downstreamリンクを見直し、循環を解消してください。`,
      'DOC-05': `以下のドキュメントの見出しに章番号を付与し、連番になるよう修正してください。\n\nファイル: ${path}\n\n例:\n## 1. セクションタイトル\n### 1.1 サブセクション`,
      'DOC-06': `以下のドキュメントに有効な目次を追加してください。\n\nファイル: ${path}\n\n手順:\n1. \"## 目次\" セクションを追加\n2. 各見出しに対応するリンク [1. タイトル](#1-タイトル) を列挙\n3. リンク先のアンカーが実際の見出しと一致していることを確認`,
      'DOC-07': `以下のドキュメントのファイル名を命名規則に合わせてください。\n\nファイル: ${path}\n\n命名ルール:\n- PRD/QA層: *.mdc\n- ARCH層: *.mdc または *.md\n- 空白や禁則文字を含めない`,
      'DOC-08': `以下のドキュメントに扱う内容/扱わない内容のセクションを整備してください。\n\nファイル: ${path}\n\n推奨構成:\n## 扱う内容\n- 箇条書きで範囲を記載\n## 扱わない内容\n- 箇条書きで非対象を記載`,
      'TC-01': `以下のテストケースファイルを命名規則に合わせてリネームしてください。\n\nファイル: ${path}\n\n形式: [分類]-[機能]-[シナリオ].spec.ts （例: docs-navigator-tree-smoke.spec.ts）`,
      'TC-02': `以下のテストケースから他テストへの依存関係を排除してください。\n\nファイル: ${path}\n\n依存パターン（test.then, beforeAllで他テスト参照 など）を解消し、各テストが独立して動作するようにしてください。`,
      'TC-03': `以下のテストケースに目的と期待結果のコメントを追加してください。\n\nファイル: ${path}\n\n各 test/it の直前に /** 目的: ... 期待結果: ... */ 形式のコメントを記述し、80%以上のカバレッジを確保してください。`,
      'TC-04': `以下のテストケースでテストデータ管理を整備してください。\n\nファイル: ${path}\n\nチェック項目:\n- fixtures/ 配下のテストデータを参照しているか\n- beforeAll/test.beforeAll でセットアップ済みか\n- afterAll/test.afterAll で後処理しているか`
    };
    
    const prompt = prompts[gateId] || '';
    navigator.clipboard.writeText(prompt).then(() => {
      alert('修正プロンプトをコピーしました（Cursor autoに貼り付けてください）');
    }).catch(() => {
      alert(`修正プロンプト:\n\n${prompt}`);
    });
  }

  function addGateIconToNode(nodeDiv, path, gateResults) {
    const violations = [];
    for (const gateId of DOC_GATES) {
      const matches = (gateResults[gateId] || []).filter(v => v.path === path);
      for (const v of matches) {
        violations.push({ gateId, severity: v.severity || GATE_SEVERITY[gateId] || 'error' });
      }
    }

    if (violations.length > 0) {
      const hasError = violations.some(v => v.severity === 'error');
      const icon = hasError ? '⛔' : '⚠';
      const span = document.createElement('span');
      span.className = `tree-node-icon ${hasError ? 'error' : 'warn'}`;
      span.textContent = icon;
      span.title = violations.map(v => v.gateId).join(', ');
      nodeDiv.querySelector('.tree-node-content').appendChild(span);
    }
  }

  async function renderTree() {
    console.log('[renderTree] === START ===');
    console.log('[renderTree] window.entries exists:', !!window.entries, 'count:', window.entries?.length);
    console.log('[renderTree] window.treeView exists:', !!window.treeView);
    console.log('[renderTree] window.treeDirection value:', window.treeDirection?.value);
    
    const tView = window.treeView || document.getElementById('tree-view');
    if (!tView) { console.error('[renderTree] treeView not found!'); return; }

    setTreeStatus('Tree構造を解析中...', 'info');
    tView.classList.remove('empty-state');
    tView.innerHTML = '<div class="tree-loading">Loading...</div>';
    if (treeDetailPanel) {
      treeDetailPanel.classList.add('empty-state');
      treeDetailPanel.textContent = 'ノードを選択するとリンクが表示されます';
    }
    if (gateResultsPanel) {
      gateResultsPanel.classList.add('empty-state');
      gateResultsPanel.textContent = 'Validateを押してGate結果を確認しましょう';
    }
    try {
      console.log('[renderTree] Calling parseAllBreadcrumbs()...');
      const { nodes, docStatus, docContents } = await parseAllBreadcrumbs();
      console.log('[renderTree] parseAllBreadcrumbs returned nodes:', nodes.size);

      const direction = window.treeDirection ? window.treeDirection.value : 'downstream';
      console.log('[renderTree] direction =', direction);
      console.log('[renderTree] Calling buildTree()...');
      for (const node of nodes.values()) {
        node.expanded = expandedPaths.has(node.path);
      }
      const rootNodes = buildTree(nodes, direction);
      console.log('[renderTree] buildTree returned rootNodes:', rootNodes.length);
      
      const gateResults = await validateGates(nodes, docStatus, docContents);
      currentGateResults = gateResults;
      renderGateResults(gateResults);
      
      // Save test results to file for E2E validation
      const testResults = {
        timestamp: new Date().toISOString(),
        nodesCount: nodes.size,
        rootNodesCount: rootNodes.length,
        direction: direction,
        gateResults: gateResults,
        treeStructure: rootNodes.map(root => ({
          path: root.path,
          layer: root.layer,
          downstream: root.downstream,
          upstream: root.upstream,
          childrenCount: root.children.length
        }))
      };
      console.log('TEST_RESULT:', JSON.stringify(testResults, null, 2));
      
      tView.innerHTML = '';
      const entriesData = window.entries || [];
      for (const root of rootNodes) {
        console.log('renderTree: rendering root:', root.path);
        tView.appendChild(renderTreeNode(root, 0, entriesData, gateResults));
      }
      if (rootNodes.length === 0) {
        const msg = 'No root nodes found (upstream=N/A or downstream=N/A)';
        console.warn('renderTree:', msg);
        tView.innerHTML = `<div class="tree-loading">${msg}</div>`;
        setTreeStatus('ルートが見つかりません', 'warn');
      } else {
        console.log('renderTree: success, rendered', rootNodes.length, 'root nodes');
        setTreeStatus(`✓ ${rootNodes.length} roots`, 'success');
      }
    } catch (e) {
      console.error('renderTree error:', e);
      console.error('renderTree error stack:', e.stack);
      tView.innerHTML = `<div class="tree-error">Error: ${escapeHtml(e.message)}</div>`;
      setTreeStatus('✗ Error', 'error');
    }
  }
  
  // Expose renderTree globally for E2E tests
  window.renderTree = renderTree;
  
  // 必ずwindow.entriesを設定する
  window.entries = entries;
  
  // Signal that docs-navigator has finished initializing
  window.docsNavigatorReady = true;
  console.log('[Docs Navigator] Initialization complete');
  console.log('[Docs Navigator] Entries loaded:', entries.length);
  console.log('[Docs Navigator] window.entries set to:', window.entries ? window.entries.length : 'undefined');
  console.log('[Docs Navigator] Mode buttons:', modeButtons.length);
  console.log('[Docs Navigator] Tree view element:', !!window.treeView);
})();

