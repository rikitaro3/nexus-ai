// Ported Docs Navigator (Docs/FEATs/Orphans)
(async function initDocsNavigator() {
  console.log('[Docs Navigator] === INIT START ===');
  const catEl = document.getElementById('docs-categories');
  const listEl = document.getElementById('docs-list');
  const detailEl = document.getElementById('docs-detail');
  const modeButtons = document.querySelectorAll('.docs-mode-btn');
  console.log('[Docs Navigator] Basic elements - catEl:', !!catEl, 'listEl:', !!listEl, 'detailEl:', !!detailEl);
  console.log('[Docs Navigator] modeButtons count:', modeButtons.length);

  if (!catEl || !listEl || !detailEl) {
    console.error('[Docs Navigator] Required elements not found!');
    return;
  }

  // context source (repo or nexus). default repo unless debug & previously saved
  let contextPath = '.cursor/context.mdc';
  let entries = [];
  try {
    const dbg = await window.env.isDebug();
    const isDebug = dbg && dbg.success && dbg.isDebug;
    const wrap = document.getElementById('context-select-wrap');
    const select = document.getElementById('context-select');
    
    // 優先順位: カスタムパス（localStorage） > 環境変数 > デフォルト
    const customContextPath = localStorage.getItem('context-file-path');
    
    // E2Eテスト時はデフォルトでnexusコンテキストを使用
    const saved = localStorage.getItem('nexus.context');
    const contextToUse = saved || (isDebug ? 'nexus' : 'repo');
    
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
    const ctxRes = await window.docs.read(contextPath);
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
      // entriesは空のまま初期化を続行
      window.entries = entries;
      console.log('[Docs Navigator] Initialization with empty entries');
      return; // 早期リターンして処理を続行
    }
    console.log('[Docs Navigator] Context loaded, size:', ctxRes.content.length);
    console.log('[Docs Navigator] Context content preview:', ctxRes.content.substring(0, 200));
    const ctx = ctxRes.content;
    const mapSection = extractSection(ctx, '## Context Map', '## ');
    console.log('[Docs Navigator] Map section found:', !!mapSection, 'length:', mapSection?.length || 0);
    entries = [];
    window.entries = entries;
    const categoryOrder = [];
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

    const traceSection = extractSection(ctx, '## Traceability Map', '## ');
    const waypointsSection = extractSection(ctx, '### Waypoints', '### ');
    const meceSection = extractSection(ctx, '### MECE Domains', '### ');

    const registry = await parseFeaturesRegistry();
    let filteredFeats = registry.items;

    catEl.innerHTML = '';
    for (const cat of categoryOrder) {
      const li = document.createElement('li');
      li.textContent = cat;
      li.addEventListener('click', () => renderList(cat));
      catEl.appendChild(li);
    }

    const orphanTitle = document.createElement('h3');
    orphanTitle.textContent = 'Orphans';
    const orphanList = document.createElement('ul');
    orphanList.id = 'docs-orphans';
    catEl.parentElement.appendChild(orphanTitle);
    catEl.parentElement.appendChild(orphanList);

    let orphanMap = await detectOrphans(entries);
    renderOrphans(orphanMap);

    function renderList(cat) {
      listEl.innerHTML = '';
      const filtered = entries.filter(e => e.category === cat);
      for (const e of filtered) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = e.path;
        a.addEventListener('click', async (ev) => { ev.preventDefault(); renderDetail(e); });
        li.appendChild(a);
        const span = document.createElement('span');
        span.textContent = ` — ${e.desc}`;
        li.appendChild(span);
        listEl.appendChild(li);
      }
    }

    async function renderDetail(entry) {
      let extra = '';
      let orphanBadge = '';
      try {
        if (entry.path.endsWith('index.mdc')) {
          const res = await window.docs.read(entry.path);
          if (res.success) {
            const bc = extractBreadcrumbs(res.content);
            if (bc) extra = `<pre>${escapeHtml(bc)}</pre>`;
            const isOrphan = orphanMap.get(entry.path) === true;
            orphanBadge = `<span class="status ${isOrphan ? 'stopped' : 'running'}">${isOrphan ? 'Orphan' : 'Linked'}</span>`;
          }
        }
      } catch {}
      const gatesLink = `<button id="open-gates">Quality Gates 定義を開く</button>`;
      detailEl.innerHTML = `
        <div>
          <p><strong>${escapeHtml(entry.path)}</strong> ${orphanBadge}</p>
          <p>${escapeHtml(entry.desc)}</p>
          ${extra}
          <div class="control-group"><button id="open-doc">このドキュメントを開く</button></div>
          <hr/>
          <h4>Traceability Map</h4>
          <pre>${escapeHtml(traceSection || '(not found)')}</pre>
          <h4>Waypoints</h4>
          <pre>${escapeHtml(waypointsSection || '(not found)')}</pre>
          <h4>MECE Domains</h4>
          <pre>${escapeHtml(meceSection || '(not found)')}</pre>
          ${gatesLink}
        </div>`;
      document.getElementById('open-doc').addEventListener('click', async () => { await window.docs.open(entry.path); });
      document.getElementById('open-gates').addEventListener('click', async () => { await window.docs.open('.cursor/gates.traceability.mdc'); });
    }

    const docsMode = document.getElementById('docs-mode-docs');
    const featsMode = document.getElementById('docs-mode-feats');
    const treeMode = document.getElementById('docs-mode-tree');
    window.treeView = document.getElementById('tree-view');
    const treeView = window.treeView;
    const treeDetail = document.getElementById('tree-detail');
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
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        console.log('[Mode Switch] Switching to mode:', mode);
        docsMode.classList.toggle('active', mode === 'docs');
        featsMode.classList.toggle('active', mode === 'feats');
        treeMode.classList.toggle('active', mode === 'tree');
        console.log('[Mode Switch] Classes applied - docs:', docsMode.classList.contains('active'), 
                    'feats:', featsMode.classList.contains('active'), 
                    'tree:', treeMode.classList.contains('active'));
        if (mode === 'tree') { 
          console.log('[Mode Switch] Tree mode activated, calling renderTree()');
          renderTree(); 
        }
      });
    });
    console.log('[Docs Navigator] Mode buttons initialized');

    if (treeDirection) {
      treeDirection.addEventListener('change', () => { renderTree(); });
    }

    document.getElementById('tree-validate')?.addEventListener('click', () => {
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
    if (categoryOrder.length > 0) renderList(categoryOrder[0]);
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
    if (dupIds && dupIds.length > 0) {
      if (featDupAlert) {
        featDupAlert.style.display = '';
        featDupAlert.textContent = `重複ID: ${dupIds.join(', ')}`;
        featDupAlert.classList.add('stopped');
      }
    } else if (featDupAlert) {
      featDupAlert.style.display = 'none';
    }
    for (const it of items) { const coverage = computeCoverage(it.links); const li = document.createElement('li'); const a = document.createElement('a'); a.href = '#'; a.textContent = `${it.id} — ${it.title} (${coverage.passed}/5)`; a.addEventListener('click', (ev) => { ev.preventDefault(); renderFeatDetail(it, coverage); }); li.appendChild(a); featsList.appendChild(li); }
    if (items.length > 0) renderFeatDetail(items[0], computeCoverage(items[0].links));
  }
  function computeCoverage(links) { const keys = ['PRD','UX','API','DATA','QA']; let passed = 0; const missing = []; for (const k of keys) { if (links[k] && links[k].trim()) passed++; else missing.push(k); } return { passed, missing }; }
  async function renderFeatDetail(feat, coverage) {
    const featDetail = document.getElementById('feats-detail');
    if (!featDetail) return;
    const rows = []; for (const k of ['PRD','UX','API','DATA','QA']) { const val = feat.links[k] || ''; const path = val.split('#')[0].trim(); const openBtn = path ? `<button data-open="${escapeHtml(path)}" class="btn btn-sm">Open</button>` : ''; rows.push(`<tr><td>${k}</td><td>${escapeHtml(val || '(missing)')}</td><td>${openBtn}</td></tr>`); }
    const warn = coverage.missing.length ? `<div class="status">不足: ${coverage.missing.join(', ')}</div>` : `<div class="status">OK</div>`;
    featDetail.innerHTML = `<div><p><strong>${escapeHtml(feat.id)}</strong> — ${escapeHtml(feat.title)}</p>${warn}<table><thead><tr><th>Layer</th><th>Link</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    featDetail.querySelectorAll('button[data-open]').forEach(btn => { btn.addEventListener('click', async () => { const rel = btn.getAttribute('data-open'); await window.docs.open(rel); }); });
  }
  async function detectOrphans(entries) {
    const map = new Map(); const indexEntries = entries.filter(e => /(^|\/)docs\/.+\/index\.mdc$/.test(e.path)); for (const e of indexEntries) { try { const res = await window.docs.read(e.path); if (!res.success) { map.set(e.path, true); continue; } const bc = extractBreadcrumbs(res.content); if (!bc) { map.set(e.path, true); continue; } const up = (bc.match(/>\s*Upstream:\s*(.*)/) || [])[1] || ''; const down = (bc.match(/>\s*Downstream:\s*(.*)/) || [])[1] || ''; const isEmpty = (v) => !v || v.trim() === '' || v.trim().toUpperCase() === 'N/A'; map.set(e.path, isEmpty(up) && isEmpty(down)); } catch { map.set(e.path, true); } } return map;
  }
  function renderOrphans(orphanMap) { const list = document.getElementById('docs-orphans'); if (!list) return; list.innerHTML = ''; const orphans = Array.from(orphanMap.entries()).filter(([, v]) => v).map(([k]) => k).sort(); const title = list.previousElementSibling; if (title && title.tagName === 'H3') { title.textContent = `Orphans (${orphans.length})`; } for (const p of orphans) { const li = document.createElement('li'); const a = document.createElement('a'); a.href = '#'; a.textContent = p; a.addEventListener('click', (ev) => { ev.preventDefault(); const entry = { path: p, desc: '(Orphan candidate)' }; (async () => { await renderDetail(entry); })(); }); li.appendChild(a); list.appendChild(li); } }

  async function parseAllBreadcrumbs() {
    console.log('[parseAllBreadcrumbs] === START ===');
    const nodes = new Map();
    const entriesData = window.entries || [];
    console.log('[parseAllBreadcrumbs] Processing entries:', entriesData.length);
    for (const entry of entriesData) {
      console.log('[parseAllBreadcrumbs] Processing:', entry.path);
      try {
        const res = await window.docs.read(entry.path);
        if (!res.success) { console.log('[parseAllBreadcrumbs] Failed to read:', entry.path); continue; }
        const bc = extractBreadcrumbs(res.content);
        if (!bc) { console.log('[parseAllBreadcrumbs] No breadcrumbs in:', entry.path); continue; }
        const layer = (bc.match(/>\s*Layer:\s*(.+)/) || [])[1] || '';
        const upRaw = (bc.match(/>\s*Upstream:\s*(.+)/) || [])[1] || '';
        const downRaw = (bc.match(/>\s*Downstream:\s*(.+)/) || [])[1] || '';
        const upstream = upRaw.split(',').map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'N/A');
        const downstream = downRaw.split(',').map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'N/A');
        console.log('[parseAllBreadcrumbs] Extracted - path:', entry.path, 'layer:', layer, 'upstream:', upstream, 'downstream:', downstream);
        nodes.set(entry.path, { path: entry.path, layer, upstream, downstream, children: [], expanded: false });
      } catch (e) { console.warn('[parseAllBreadcrumbs] Failed to parse:', entry.path, e); }
    }
    console.log('[parseAllBreadcrumbs] === COMPLETE === nodes:', nodes.size);
    return nodes;
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
    const detailPanel = window.treeDetail;
    if (!detailPanel) return;
    
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
      if (hasChildren) node.expanded = !node.expanded;
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

  async function validateGates(nodes) {
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
    
    const cycles = detectCycles(nodes);
    results['DOC-04'] = cycles;
    
    return results;
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
    const panel = document.getElementById('gate-results');
    if (!panel) return;
    
    panel.innerHTML = '';
    const gates = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04'];
    
    for (const gateId of gates) {
      const violations = results[gateId];
      const status = violations.length === 0 ? 'pass' : (gateId === 'DOC-04' ? 'warn' : 'error');
      const statusText = violations.length === 0 ? '✓ PASS' : `✗ ${violations.length} violation(s)`;
      
      const gateDiv = document.createElement('div');
      gateDiv.className = `gate-result ${status}`;
      gateDiv.innerHTML = `<strong>${gateId}</strong>: ${statusText}`;
      
      if (violations.length > 0) {
        for (const v of violations) {
          const vDiv = document.createElement('div');
          vDiv.className = 'gate-violation';
          vDiv.innerHTML = `
            <div>${escapeHtml(v.path)}</div>
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
      'DOC-04': `以下のドキュメントで循環参照を解消してください。\n\nファイル: ${path}\n\nUpstream/Downstreamリンクを見直し、循環を解消してください。`
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
    for (const gateId of ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04']) {
      const v = gateResults[gateId].find(v => v.path === path);
      if (v) violations.push({ gateId, severity: gateId === 'DOC-04' ? 'warn' : 'error' });
    }
    
    if (violations.length > 0) {
      const hasError = violations.some(v => v.severity === 'error');
      const icon = hasError ? '⚠️' : '⚠';
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
    
    const statusEl = document.getElementById('tree-status');
    const tView = window.treeView || document.getElementById('tree-view');
    if (!tView) { console.error('[renderTree] treeView not found!'); return; }
    if (statusEl) statusEl.textContent = 'Loading...';
    
    tView.innerHTML = '<div class="tree-loading">Loading...</div>';
    try {
      console.log('[renderTree] Calling parseAllBreadcrumbs()...');
      const nodes = await parseAllBreadcrumbs();
      console.log('[renderTree] parseAllBreadcrumbs returned nodes:', nodes.size);
      
      const direction = window.treeDirection ? window.treeDirection.value : 'downstream';
      console.log('[renderTree] direction =', direction);
      console.log('[renderTree] Calling buildTree()...');
      const rootNodes = buildTree(nodes, direction);
      console.log('[renderTree] buildTree returned rootNodes:', rootNodes.length);
      
      const gateResults = await validateGates(nodes);
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
        if (statusEl) statusEl.textContent = 'No roots';
      } else {
        console.log('renderTree: success, rendered', rootNodes.length, 'root nodes');
        if (statusEl) statusEl.textContent = `✓ ${rootNodes.length} roots`;
      }
    } catch (e) {
      console.error('renderTree error:', e);
      console.error('renderTree error stack:', e.stack);
      tView.innerHTML = `<div class="tree-error">Error: ${escapeHtml(e.message)}</div>`;
      if (statusEl) statusEl.textContent = '✗ Error';
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

