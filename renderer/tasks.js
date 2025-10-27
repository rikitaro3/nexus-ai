// Ported Tasks (import/edit/save/export/breakdown)
(function initTasks() {
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

  if (!listEl || !catsEl || !detailEl) return;

  let tasks = []; let filteredTasks = []; let featsRegistry = null;
  function uid() { return 'T' + Math.random().toString(36).slice(2, 10); }
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
  function parsePasted(text) { const out = []; const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean); for (const line of lines) { const m = line.match(/^【([^】]+)】\s*(.+)$/); const category = m ? m[1] : 'Uncategorized'; const title = m ? m[2] : line; out.push({ id: uid(), title, category, priority: 'MEDIUM', status: 'TODO', featId: '', links: {}, notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); } return out; }
  function renderCategories(items) { const cats = new Map(); for (const t of items) cats.set(t.category, (cats.get(t.category) || 0) + 1); catsEl.innerHTML=''; for (const [c,n] of Array.from(cats.entries()).sort()) { const li=document.createElement('li'); li.textContent = `${c} (${n})`; li.addEventListener('click', ()=>{ filteredTasks = tasks.filter(t=>t.category===c); renderList(); }); catsEl.appendChild(li); } }
  function renderList() { const source = filteredTasks.length ? filteredTasks : tasks; listEl.innerHTML=''; for (const t of source) { const li=document.createElement('li'); const a=document.createElement('a'); a.href='#'; a.textContent=`${t.title}`; a.addEventListener('click',(ev)=>{ev.preventDefault(); renderDetail(t.id);}); li.appendChild(a); const meta=document.createElement('span'); meta.textContent=` — ${t.category} / ${t.priority} / ${t.status} ${t.featId ? '/ '+t.featId : ''}`; li.appendChild(meta); listEl.appendChild(li);} }
  async function renderDetail(id) {
    const t = tasks.find(x=>x.id===id); if (!t) { detailEl.innerHTML=''; return; }
    const feats = await loadFeats(); const featOpts = [''].concat(feats.items.map(i=>i.id)); const featSuggest = t.featId ? feats.items.find(i=>i.id===t.featId) : null;
    detailEl.innerHTML = `
      <div class="form-group"><label>タイトル</label><input id="task-title" type="text" value="${escapeHtml(t.title)}"/></div>
      <div class="form-group"><label>カテゴリ</label><input id="task-category" type="text" value="${escapeHtml(t.category)}"/></div>
      <div class="form-group"><label>優先度</label><select id="task-priority"><option ${t.priority==='HIGH'?'selected':''}>HIGH</option><option ${t.priority==='MEDIUM'?'selected':''}>MEDIUM</option><option ${t.priority==='LOW'?'selected':''}>LOW</option></select></div>
      <div class="form-group"><label>ステータス</label><select id="task-status"><option ${t.status==='TODO'?'selected':''}>TODO</option><option ${t.status==='IN_PROGRESS'?'selected':''}>IN_PROGRESS</option><option ${t.status==='DONE'?'selected':''}>DONE</option></select></div>
      <div class="form-group"><label>FEAT-ID</label><select id="task-feat">${featOpts.map(v=>`<option ${t.featId===v?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="form-group"><label>Notes</label><textarea id="task-notes" rows="4">${escapeHtml(t.notes||'')}</textarea></div>
      <hr/>
      <div class="form-group"><label>Breakdown Prompt</label><div class="control-group"><button id="task-generate-breakdown" class="btn btn-primary">Generate</button><button id="task-copy-breakdown" class="btn btn-secondary">Copy for Cursor auto</button><select id="task-breakdown-status"><option ${t.breakdownStatus==='DRAFT'?'selected':''}>DRAFT</option><option ${t.breakdownStatus==='READY'?'selected':''}>READY</option><option ${t.breakdownStatus==='REVIEWED'?'selected':''}>REVIEWED</option></select><span class="status" id="task-breakdown-stamp">${t.lastBreakdownAt?`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`:''}</span></div><textarea id="task-breakdown-prompt" rows="10" placeholder="Generateで雛形を作成">${escapeHtml(t.breakdownPrompt||'')}</textarea></div>
      <div class="control-group"><button id="task-save" class="btn btn-primary">更新</button>${featSuggest?`<button id="task-open-prd" class="btn btn-secondary">PRD</button>`:''}${featSuggest?`<button id="task-open-ux" class="btn btn-secondary">UX</button>`:''}${featSuggest?`<button id="task-open-api" class="btn btn-secondary">API</button>`:''}${featSuggest?`<button id="task-open-data" class="btn btn-secondary">DATA</button>`:''}${featSuggest?`<button id="task-open-qa" class="btn btn-secondary">QA</button>`:''}</div>`;
    function getPath(v){return v?v.split('#')[0].trim():'';}
    const openBy = async (key)=>{ const p=featSuggest&&getPath(featSuggest.links[key]); if(p) await window.docs.open(p); };
    document.getElementById('task-save').addEventListener('click', ()=>{ t.title=document.getElementById('task-title').value.trim(); t.category=document.getElementById('task-category').value.trim()||'Uncategorized'; t.priority=document.getElementById('task-priority').value; t.status=document.getElementById('task-status').value; t.featId=document.getElementById('task-feat').value.trim(); t.notes=document.getElementById('task-notes').value; const bdTextarea=document.getElementById('task-breakdown-prompt'); if(bdTextarea) t.breakdownPrompt=bdTextarea.value; const bdStatus=document.getElementById('task-breakdown-status'); if(bdStatus) t.breakdownStatus=bdStatus.value; t.updatedAt=new Date().toISOString(); renderCategories(tasks); renderList(); });
    if (featSuggest) { const map={PRD:'task-open-prd',UX:'task-open-ux',API:'task-open-api',DATA:'task-open-data',QA:'task-open-qa'}; for (const k of Object.keys(map)) { const btn=document.getElementById(map[k]); if(btn) btn.addEventListener('click',()=>openBy(k)); } }
    const genBtn=document.getElementById('task-generate-breakdown'); const copyBtn=document.getElementById('task-copy-breakdown');
    if(genBtn) genBtn.addEventListener('click', async ()=>{ const featId=document.getElementById('task-feat').value.trim(); const reg=await loadFeats(); const item=reg.items.find(i=>i.id===featId); const links=item?item.links:{}; const prompt=buildBreakdownPrompt({ title:document.getElementById('task-title').value.trim(), category:document.getElementById('task-category').value.trim(), priority:document.getElementById('task-priority').value, featId, links }); const ta=document.getElementById('task-breakdown-prompt'); if(ta) ta.value=prompt; t.breakdownPrompt=prompt; t.lastBreakdownAt=new Date().toISOString(); const stamp=document.getElementById('task-breakdown-stamp'); if(stamp) stamp.textContent=`Last: ${new Date(t.lastBreakdownAt).toLocaleString('ja-JP')}`; });
    if(copyBtn) copyBtn.addEventListener('click', async ()=>{ const ta=document.getElementById('task-breakdown-prompt'); const txt=ta?ta.value:''; if(!txt){ alert('Breakdown Promptが空です'); return;} try{ await navigator.clipboard.writeText(txt); alert('コピーしました（Cursor autoに貼り付けてください）'); }catch(e){ alert('クリップボードへのコピーに失敗しました'); } });
  }
  function escapeHtml(s){return String(s||'').replace(/[&<>]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));}
  function buildBreakdownPrompt({ title, category, priority, featId, links }) {
    const linksText = Object.entries(links || {}).map(([k,v]) => `- ${k}: ${v}`).join('\n');
    return [
      'あなたはプロジェクトの実装ブレークダウン設計者です。以下の制約と入力を踏まえ、MECEなサブタスク（各項目に完了基準付き）を5〜10件で提案し、不明点（最大5件）と参照先（PRD/UX/API/DATA/QA）も挙げてください。',
      '', '[制約]', '- 外部AI APIを使わない（Cursor autoのみ）', '- 冗長禁止、簡潔さ重視', '- DAG/MECE/Quality Gatesを尊重（context.mdc参照）',
      '', '[入力]', `- タスク: ${title} / カテゴリ: ${category} / 優先度: ${priority} / FEAT: ${featId||''}`, '- 関連ドキュメント:', linksText || '- (なし)',
      '', '[出力]', '- サブタスク一覧: [ {name, acceptanceCriteria, refs} ... ]', '- 不明点: [question1..]', '- 参照: [PRD/UX/API/DATA/QAの相対パスとアンカー]'
    ].join('\n');
  }
  if (bulkImportBtn) bulkImportBtn.addEventListener('click', ()=>{ const text=(bulkTextarea&&bulkTextarea.value)||''; if(!text.trim()){alert('貼り付け欄が空です'); return;} const newOnes=parsePasted(text); if(!newOnes.length){ alert('取り込み対象がありません'); return;} tasks=tasks.concat(newOnes); filteredTasks=[]; renderCategories(tasks); renderList(); bulkTextarea.value=''; alert(`${newOnes.length}件を取り込みました`); });
  if (addOneBtn) addOneBtn.addEventListener('click', ()=>{ const cat=(addCatInput&&addCatInput.value.trim())||'Uncategorized'; const title=(addTitleInput&&addTitleInput.value.trim())||''; if(!title){alert('タイトルを入力してください'); return;} const [item]=parsePasted(`【${cat}】 ${title}`); tasks.push(item); renderCategories(tasks); renderList(); if(addTitleInput) addTitleInput.value=''; });
  saveBtn.addEventListener('click', async ()=>{ const res=await window.tasks.writeJson(tasks); alert(res.success?'保存しました':`保存失敗: ${res.error}`); });
  exportBtn.addEventListener('click', async ()=>{ const lines=tasks.map(t=>`- [${t.status}] (${t.priority}) ${t.title} ${t.featId? '['+t.featId+']':''} #${t.category}`); const md=lines.join('\n'); const res=await window.tasks.appendMdc('human_todo.mdc', md); alert(res.success?'human_todo.mdcに追記しました':`エクスポート失敗: ${res.error}`); });
  filterInput.addEventListener('input', ()=>{ const q=filterInput.value.trim().toLowerCase(); if(!q){ filteredTasks=[]; renderList(); return;} filteredTasks=tasks.filter(t=>(t.title+' '+t.category+' '+(t.featId||'')).toLowerCase().includes(q)); renderList(); });
  (async ()=>{ const res=await window.tasks.readJson(); tasks=res.success&&Array.isArray(res.data)?res.data:[]; renderCategories(tasks); renderList(); })();
})();

