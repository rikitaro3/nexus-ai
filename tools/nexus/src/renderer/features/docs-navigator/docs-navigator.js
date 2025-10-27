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
  const modeDescriptions = {
    docs: 'カテゴリからドキュメントを探索します',
    feats: 'FEATのカバレッジと関連ドキュメントを確認します',
    tree: 'Breadcrumbsからリンク構造を検証します'
  };
  const MODE_STORAGE_KEY = 'nexus.docs.mode';
  const VALID_DOC_MODES = new Set(['docs', 'feats', 'tree']);

  function normalizePreferenceValue(value) {
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    try {
      return String(value).trim();
    } catch (err) {
      console.warn('[Docs Navigator] Failed to normalize preference value:', err);
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
        console.warn('[Docs Navigator] Failed to read preference from storage:', storageKey, err);
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
        console.warn('[Docs Navigator] Failed to persist preference:', storageKey, err);
        return defaultValue;
      }
    }

    function clear() {
      if (!hasStorage()) return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch (err) {
        console.warn('[Docs Navigator] Failed to clear preference:', storageKey, err);
      }
    }

    return { read, write, clear };
  }

  const docModePreference = createStringPreference(MODE_STORAGE_KEY, {
    defaultValue: 'tree',
    validate: value => VALID_DOC_MODES.has(value)
  });
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

  const treeModeRoot = document.getElementById('docs-mode-tree');
  const pipelinePanel = document.createElement('div');
  pipelinePanel.id = 'rules-pipeline';
  pipelinePanel.className = 'rules-pipeline hidden';
  pipelinePanel.innerHTML = `
    <div class="rules-pipeline__header">
      <div class="rules-pipeline__title">
        <strong>Quality Gates Pipeline</strong>
        <span class="rules-pipeline__timestamp" data-role="timestamp"></span>
      </div>
      <div class="rules-pipeline__actions">
        <button id="rules-revalidate" class="btn btn-secondary btn-sm">再検証</button>
        <button id="rules-bulk-update" class="btn btn-secondary btn-sm">一括更新</button>
        <button id="rules-scan-impacts" class="btn btn-secondary btn-sm">影響再スキャン</button>
      </div>
    </div>
    <div class="rules-pipeline__status" data-role="status">Quality Gatesの状態を取得中...</div>
    <div class="rules-pipeline__summary" data-role="summary"></div>
    <div class="rules-pipeline__diff" data-role="diff"></div>
    <div class="rules-pipeline__autofix" data-role="autofix"></div>
    <div class="rules-pipeline__repo-diff" data-role="repo-diff"></div>
    <div class="rules-pipeline__analytics" data-role="analytics"></div>
    <div class="rules-pipeline__impacts" data-role="impacts"></div>
    <div class="rules-pipeline__logs" data-role="logs"></div>
  `;
  const treeSplitRoot = treeModeRoot ? treeModeRoot.querySelector('.docs-split') : null;
  if (treeModeRoot) {
    if (treeSplitRoot) {
      treeModeRoot.insertBefore(pipelinePanel, treeSplitRoot);
    } else {
      treeModeRoot.appendChild(pipelinePanel);
    }
  }

  const pipelineStatusEl = pipelinePanel.querySelector('[data-role="status"]');
  const pipelineSummaryEl = pipelinePanel.querySelector('[data-role="summary"]');
  const pipelineDiffEl = pipelinePanel.querySelector('[data-role="diff"]');
  const pipelineAutofixEl = pipelinePanel.querySelector('[data-role="autofix"]');
  const pipelineRepoDiffEl = pipelinePanel.querySelector('[data-role="repo-diff"]');
  const pipelineAnalyticsEl = pipelinePanel.querySelector('[data-role="analytics"]');
  const pipelineImpactsEl = pipelinePanel.querySelector('[data-role="impacts"]');
  const pipelineLogsEl = pipelinePanel.querySelector('[data-role="logs"]');
  const pipelineTimestampEl = pipelinePanel.querySelector('[data-role="timestamp"]');
  const pipelineRevalidateBtn = pipelinePanel.querySelector('#rules-revalidate');
  const pipelineBulkBtn = pipelinePanel.querySelector('#rules-bulk-update');
  const pipelineScanBtn = pipelinePanel.querySelector('#rules-scan-impacts');
  const rulesWatcherApi = typeof window !== 'undefined' ? window.rulesWatcher : null;
  let detachRulesWatcher = null;
  let currentRulesWatcherContext = null;

  const SEGMENT_LABELS = { auto: '自動', semiAuto: '半自動', manual: '手動' };
  const STATUS_LABELS = { idle: '待機中', running: '実行中', completed: '完了', error: 'エラー' };
  const DOCUMENT_GATE_ORDER = ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08'];
  const TEST_CASE_GATE_ORDER = ['TC-01', 'TC-02', 'TC-03', 'TC-04'];
  const ALL_QUALITY_GATES = [...DOCUMENT_GATE_ORDER, ...TEST_CASE_GATE_ORDER];

  let latestGateResults = null;
  let latestGateResultsSource = 'unknown';
  let latestGateResultsTimestamp = null;
  let latestGateContextPath = null;

  function formatTimestamp(value) {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('ja-JP', { hour12: false });
    } catch (err) {
      console.warn('[Docs Navigator] Failed to format timestamp', err);
      return value;
    }
  }

  function normalizeGatePath(value) {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/\\/g, '/').trim();
  }

  function sanitizeGateViolation(gateId, violation) {
    if (!violation || typeof violation !== 'object') {
      return { gateId, message: '不明な違反', severity: 'info' };
    }
    const normalized = { ...violation };
    if (violation.path) {
      normalized.path = normalizeGatePath(violation.path);
    }
    if (!normalized.gateId) {
      normalized.gateId = gateId;
    }
    return normalized;
  }

  function sanitizeGateResults(rawResults) {
    if (!rawResults || typeof rawResults !== 'object') {
      return ALL_QUALITY_GATES.reduce((acc, gateId) => {
        acc[gateId] = [];
        return acc;
      }, {});
    }
    const sanitized = {};
    for (const [gateId, list] of Object.entries(rawResults)) {
      const array = Array.isArray(list) ? list : [];
      sanitized[gateId] = array.map(item => sanitizeGateViolation(gateId, item));
    }
    for (const gateId of ALL_QUALITY_GATES) {
      if (!Array.isArray(sanitized[gateId])) {
        sanitized[gateId] = [];
      }
    }
    return sanitized;
  }

  function setLatestGateResults(results, { source = 'unknown', timestamp = null, contextPath = null } = {}) {
    latestGateResults = sanitizeGateResults(results);
    latestGateResultsSource = source;
    latestGateResultsTimestamp = timestamp || null;
    latestGateContextPath = contextPath || null;
    console.log('[Docs Navigator] Quality Gates snapshot updated', {
      source,
      timestamp: latestGateResultsTimestamp,
      context: latestGateContextPath,
      gates: Object.keys(latestGateResults || {}).length
    });
  }

  function getViolationSeverity(violation, gateId) {
    const fromViolation = violation && typeof violation.severity === 'string'
      ? violation.severity.toLowerCase()
      : null;
    if (fromViolation === 'error' || fromViolation === 'warn' || fromViolation === 'info') {
      return fromViolation;
    }
    if (gateId === 'DOC-04' || gateId === 'DOC-08' || gateId === 'TC-02' || gateId === 'TC-03') {
      return 'warn';
    }
    return 'error';
  }

  function pickWorstSeverity(violations, gateId) {
    if (!Array.isArray(violations) || violations.length === 0) return null;
    let worst = 'info';
    for (const violation of violations) {
      const severity = getViolationSeverity(violation, violation?.gateId || gateId);
      if (severity === 'error') return 'error';
      if (severity === 'warn') worst = worst === 'info' ? 'warn' : worst;
    }
    return worst;
  }

  function severityToStatusClass(severity) {
    if (severity === 'error') return { css: 'error', label: 'ERROR' };
    if (severity === 'warn') return { css: 'warn', label: 'WARN' };
    if (severity === 'info') return { css: 'info', label: 'INFO' };
    return { css: 'pass', label: 'PASS' };
  }

  function renderPipelineSegments(state) {
    if (!state) return 'Quality Gatesパイプラインの状態を取得できませんでした。';
    const order = ['auto', 'semiAuto', 'manual'];
    const parts = [];
    for (const key of order) {
      const segment = state[key];
      if (!segment) continue;
      const label = SEGMENT_LABELS[key] || key;
      const status = STATUS_LABELS[segment.status] || segment.status;
      const when = segment.lastRunAt ? formatTimestamp(segment.lastRunAt) : '未実行';
      const exitInfo = typeof segment.exitCode === 'number' ? ` (exit ${segment.exitCode})` : '';
      parts.push(`<span class="rules-pipeline__badge">${label}</span>${status}${exitInfo} · ${when}`);
    }
    return parts.length ? parts.join(' ／ ') : 'Quality Gatesパイプラインは未実行です。';
  }

  function renderSummary(snapshot) {
    if (!snapshot) {
      return '<span class="rules-pipeline__diff-empty">Quality Gates結果はまだありません。</span>';
    }
    const header = `<strong>最新結果 (${formatTimestamp(snapshot.timestamp)})</strong>`;
    const items = Array.isArray(snapshot.summary)
      ? snapshot.summary.map(item => `<li><span class="rules-pipeline__badge">${escapeHtml(item.gateId)}</span>${item.total}件 (E:${item.severity.error} / W:${item.severity.warn} / I:${item.severity.info})</li>`)
      : [];
    if (items.length === 0) {
      return `${header}<div class="rules-pipeline__diff-empty">違反はありません。</div>`;
    }
    return `${header}<ul class="rules-pipeline__list">${items.join('')}</ul>`;
  }

  function renderDiff(snapshot) {
    if (!snapshot || !snapshot.diff) {
      return '<span class="rules-pipeline__diff-empty">差分はありません</span>';
    }
    const diff = snapshot.diff;
    if (!diff.totalAdded && !diff.totalRemoved) {
      return '<span class="rules-pipeline__diff-empty">差分はありません</span>';
    }
    const items = Array.isArray(diff.perGate)
      ? diff.perGate.slice(0, 5).map(item => {
          const added = item.added?.length ?? 0;
          const removed = item.removed?.length ?? 0;
          let details = '';
          if (added > 0) {
            const sample = item.added[0] || {};
            const sampleLabel = escapeHtml(sample.path || sample.message || '追加違反');
            details += `<div class="rules-pipeline__diff-detail">追加: ${sampleLabel}${added > 1 ? ` 他${added - 1}件` : ''}</div>`;
          }
          if (removed > 0) {
            const sample = item.removed[0] || {};
            const sampleLabel = escapeHtml(sample.path || sample.message || '解消違反');
            details += `<div class="rules-pipeline__diff-detail">解消: ${sampleLabel}${removed > 1 ? ` 他${removed - 1}件` : ''}</div>`;
          }
          return `<li><span class="rules-pipeline__badge">${escapeHtml(item.gateId)}</span>＋${added} / －${removed}${details}</li>`;
        })
      : [];
    return `
      <strong>差分プレビュー</strong>
      <div>追加: ${diff.totalAdded}件 / 解消: ${diff.totalRemoved}件</div>
      ${items.length ? `<ul class="rules-pipeline__list">${items.join('')}</ul>` : ''}
    `;
  }

  function renderAutofixOperation(operation) {
    if (!operation || typeof operation !== 'object') {
      return '<li>不明な操作</li>';
    }
    if (operation.type === 'rename') {
      const from = escapeHtml(operation.from || '不明なパス');
      const to = escapeHtml(operation.to || '不明なパス');
      const reason = operation.reason ? ` (${escapeHtml(operation.reason)})` : '';
      return `<li><strong>Rename</strong>: ${from} → ${to}${reason}</li>`;
    }
    const pathLabel = escapeHtml(operation.path || '不明なファイル');
    const actions = Array.isArray(operation.actions) && operation.actions.length
      ? `<ul class="rules-pipeline__list">${operation.actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul>`
      : '';
    return `<li><strong>Modify</strong>: ${pathLabel}${actions}</li>`;
  }

  function renderAutofix(summary) {
    if (!summary) {
      return '<span class="rules-pipeline__diff-empty">自動修復はまだ実行されていません。</span>';
    }
    const header = `<strong>自動修復 (${formatTimestamp(summary.timestamp)})</strong>`;
    const statusLabel = summary.status === 'ok' ? '成功' : '失敗';
    const statusLine = `<div>状態: ${escapeHtml(statusLabel)} (exit ${summary.exitCode}${summary.dryRun ? ', ドライラン' : ''})</div>`;
    const operations = Array.isArray(summary.operations) && summary.operations.length
      ? `<ul class="rules-pipeline__list">${summary.operations.map(renderAutofixOperation).join('')}</ul>`
      : '<div class="rules-pipeline__diff-empty">適用された操作はありません。</div>';
    const warnings = Array.isArray(summary.warnings) && summary.warnings.length
      ? `<div class="rules-pipeline__diff-detail">⚠️ ${escapeHtml(summary.warnings.join(' ／ '))}</div>`
      : '';
    const errors = Array.isArray(summary.errors) && summary.errors.length
      ? `<div class="rules-pipeline__diff-detail">❌ ${escapeHtml(summary.errors.join(' ／ '))}</div>`
      : '';
    const rawOutput = summary.rawOutput
      ? `<details><summary>自動修復ログを表示</summary><pre>${escapeHtml(summary.rawOutput)}</pre>${summary.stderr ? `<pre>${escapeHtml(summary.stderr)}</pre>` : ''}</details>`
      : '';
    return `${header}${statusLine}${operations}${warnings}${errors}${rawOutput}`;
  }

  function renderRepoDiff(diff) {
    if (!diff) {
      return '<span class="rules-pipeline__diff-empty">Git差分はありません。</span>';
    }
    const hasFiles = Array.isArray(diff.files) && diff.files.length > 0;
    const hasPatch = typeof diff.patch === 'string' && diff.patch.trim().length > 0;
    const hasNameStatus = typeof diff.nameStatus === 'string' && diff.nameStatus.trim().length > 0;
    if (!hasFiles && !hasPatch && !hasNameStatus) {
      return '<span class="rules-pipeline__diff-empty">Git差分はありません。</span>';
    }
    const header = '<strong>Git差分</strong>';
    const filesList = hasFiles
      ? `<div class="rules-pipeline__diff-detail">変更ファイル (${diff.files.length}件)</div><ul class="rules-pipeline__list">${diff.files.map(file => `<li>${escapeHtml(file)}</li>`).join('')}</ul>`
      : '';
    const nameStatusBlock = hasNameStatus
      ? `<details><summary>name-status</summary><pre>${escapeHtml(diff.nameStatus)}</pre></details>`
      : '';
    const patchDownload = hasPatch
      ? `<a href="data:text/plain;charset=utf-8,${encodeURIComponent(diff.patch)}" download="autofix.diff">差分をダウンロード</a>`
      : '';
    const patchBlock = hasPatch
      ? `<details><summary>パッチを表示</summary><pre>${escapeHtml(diff.patch)}</pre></details>`
      : '';
    return `${header}${filesList}${nameStatusBlock}${patchDownload}${patchBlock}`;
  }

  function renderAnalytics(analytics) {
    if (!analytics) {
      return '<span class="rules-pipeline__diff-empty">Analyticsデータを取得できませんでした。</span>';
    }

    const docStatusEntries = Object.entries(analytics.documents?.byStatus || {})
      .map(([status, count]) => `${escapeHtml(status)}: ${count}`)
      .join(' ／ ');
    const taskStatusEntries = Object.entries(analytics.tasks?.byStatus || {})
      .map(([status, count]) => `${escapeHtml(status)}: ${count}`)
      .join(' ／ ');

    const rows = ALL_QUALITY_GATES.map(gateId => {
      const gate = Array.isArray(analytics.gates)
        ? analytics.gates.find(item => item?.gateId === gateId)
        : null;
      const total = gate?.totalViolations ?? 0;
      const docs = gate?.uniqueDocuments ?? 0;
      const tasks = gate?.impactedTasks ?? 0;
      const severity = gate?.severity || { error: 0, warn: 0, info: 0 };
      return `
        <tr>
          <th scope="row">${escapeHtml(gateId)}</th>
          <td>${total}</td>
          <td>${docs}</td>
          <td>${tasks}</td>
          <td>E:${severity.error ?? 0} / W:${severity.warn ?? 0} / I:${severity.info ?? 0}</td>
        </tr>
      `;
    }).join('');

    return `
      <strong>最新メトリクス (${escapeHtml(formatTimestamp(analytics.generatedAt) || '未取得')})</strong>
      <div class="rules-pipeline__analytics-meta">
        <span>Docs: ${analytics.documents?.total ?? 0}件 (違反ドキュメント: ${analytics.documents?.withViolations ?? 0}件)</span>
        ${docStatusEntries ? `<span>状態: ${docStatusEntries}</span>` : ''}
        <span>Tasks: ${analytics.tasks?.total ?? 0}件${taskStatusEntries ? `（${taskStatusEntries}）` : ''}</span>
      </div>
      <div class="rules-pipeline__analytics-table-wrapper">
        <table class="rules-pipeline__analytics-table">
          <thead>
            <tr>
              <th>Gate</th>
              <th>違反件数</th>
              <th>対象ドキュメント</th>
              <th>影響タスク</th>
              <th>Severity (E/W/I)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderImpacts(impact) {
    if (!impact) {
      return '<span class="rules-pipeline__diff-empty">影響スキャンはまだ実行されていません。</span>';
    }
    const missingDocs = (impact.documents || []).filter(doc => !doc.exists).slice(0, 5);
    const warnings = (impact.warnings || []).map(w => `<li>${escapeHtml(w)}</li>`).join('');
    const missingList = missingDocs.length
      ? `<div class="rules-pipeline__missing"><strong>未検出ドキュメント</strong><ul class="rules-pipeline__list">${missingDocs.map(doc => `<li>${escapeHtml(doc.path)}</li>`).join('')}</ul></div>`
      : '';
    return `
      <strong>影響ドキュメント</strong>: ${impact.summary.total}件 (欠落: ${impact.summary.missing}件)
      <div class="rules-pipeline__meta">Context: ${impact.contextPath ? escapeHtml(impact.contextPath) : '未検出'}</div>
      ${warnings ? `<ul class="rules-pipeline__list">${warnings}</ul>` : ''}
      ${missingList}
    `;
  }

  function renderLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) {
      return '<span class="rules-pipeline__diff-empty">ログはまだありません。</span>';
    }
    const headerCells = ALL_QUALITY_GATES.map(gateId => `<th>${escapeHtml(gateId)}</th>`).join('');
    const rows = logs.slice(0, 5).map(log => {
      const modeLabel = (log.mode || '').toUpperCase();
      const summaryMap = new Map((Array.isArray(log.summary) ? log.summary : []).map(item => [item.gateId, item]));
      const gateCells = ALL_QUALITY_GATES.map(gateId => {
        const entry = summaryMap.get(gateId) || { total: 0, severity: { error: 0, warn: 0, info: 0 } };
        const total = entry.total ?? 0;
        const severity = entry.severity || { error: 0, warn: 0, info: 0 };
        return `
          <td class="rules-pipeline__history-cell">
            <div class="rules-pipeline__history-total">${total}</div>
            <div class="rules-pipeline__history-severity">E:${severity.error ?? 0} / W:${severity.warn ?? 0}</div>
          </td>
        `;
      }).join('');
      const timestamp = formatTimestamp(log.timestamp);
      const exitInfo = typeof log.exitCode === 'number' ? `exit ${log.exitCode}` : '';
      return `
        <tr>
          <td class="rules-pipeline__history-run">
            <div class="rules-pipeline__history-meta">
              <span class="rules-pipeline__badge">${escapeHtml(modeLabel)}</span>
              <span>${escapeHtml(timestamp)}</span>
              ${exitInfo ? `<span class="rules-pipeline__history-exit">${escapeHtml(exitInfo)}</span>` : ''}
            </div>
            <button class="btn btn-ghost btn-sm" data-open-log="${escapeHtml(log.relativePath)}">開く</button>
          </td>
          ${gateCells}
        </tr>
      `;
    }).join('');

    return `
      <strong>検証履歴</strong>
      <div class="rules-pipeline__history-wrapper">
        <table class="rules-pipeline__history">
          <thead>
            <tr>
              <th>Run</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async function openLog(relPath) {
    if (!relPath) return;
    try {
      await window.docs.open(relPath);
    } catch (err) {
      console.error('[Docs Navigator] Failed to open Quality Gates log', err);
      setTreeStatus('Quality Gatesログを開けませんでした', 'error');
    }
  }

  async function applyRulesWatcherContext(nextPath) {
    if (!rulesWatcherApi || typeof rulesWatcherApi.setContextPath !== 'function') return;
    const normalized = typeof nextPath === 'string' && nextPath.trim() ? nextPath.trim() : null;
    if (currentRulesWatcherContext === normalized) {
      return;
    }
    const previous = currentRulesWatcherContext;
    try {
      await rulesWatcherApi.setContextPath(normalized);
      currentRulesWatcherContext = normalized;
    } catch (err) {
      currentRulesWatcherContext = previous;
      console.warn('[Docs Navigator] Failed to update Quality Gates context', err);
      setTreeStatus('Quality Gatesのコンテキスト更新に失敗しました', 'warn');
    }
  }

  function updatePipelineView(event) {
    if (!event) return;
    pipelinePanel.classList.remove('hidden');
    pipelineStatusEl.classList.remove('rules-pipeline__status--error');
    pipelineStatusEl.innerHTML = renderPipelineSegments(event.pipeline?.state);
    if (event.error) {
      pipelineStatusEl.classList.add('rules-pipeline__status--error');
      pipelineStatusEl.innerHTML += `<div>${escapeHtml(event.error.message || 'Quality Gates監視でエラーが発生しました。')}</div>`;
    }
    const snapshot = event.pipeline?.lastRun || null;
    if (snapshot && snapshot.results) {
      setLatestGateResults(snapshot.results, {
        source: event.trigger || 'event',
        timestamp: snapshot.timestamp,
        contextPath: snapshot.contextPath || null
      });
      renderGateResults(latestGateResults);
    }
    pipelineSummaryEl.innerHTML = renderSummary(snapshot);
    pipelineDiffEl.innerHTML = renderDiff(snapshot);
    if (pipelineAutofixEl) {
      const autofixSummary = (snapshot && snapshot.autofix) || event.autofix || null;
      pipelineAutofixEl.innerHTML = renderAutofix(autofixSummary);
    }
    if (pipelineRepoDiffEl) {
      const repoDiff = (snapshot && snapshot.repoDiff) || event.repoDiff || null;
      pipelineRepoDiffEl.innerHTML = renderRepoDiff(repoDiff);
    }
    if (pipelineAnalyticsEl) {
      pipelineAnalyticsEl.innerHTML = renderAnalytics(event.analytics);
    }
    pipelineImpactsEl.innerHTML = renderImpacts(event.impact);
    pipelineLogsEl.innerHTML = renderLogs(event.logs);
    pipelineTimestampEl.textContent = formatTimestamp(event.timestamp);
    pipelineLogsEl.querySelectorAll('[data-open-log]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const rel = btn.getAttribute('data-open-log');
        await openLog(rel);
      });
    });
    if (event.trigger === 'auto' && snapshot && typeof snapshot.exitCode === 'number') {
      const tone = snapshot.exitCode === 0 ? 'success' : 'warn';
      setTreeStatus(`Quality Gatesを自動再検証しました (exit ${snapshot.exitCode})`, tone);
    } else if (event.trigger === 'scan') {
      setTreeStatus('Quality Gatesの影響を再スキャンしました', 'info');
    } else if (event.trigger === 'context') {
      setTreeStatus('Quality Gatesのコンテキストを更新しました', 'info');
    }
  }

  async function triggerRulesAction(mode) {
    if (!rulesWatcherApi || typeof rulesWatcherApi.revalidate !== 'function') return;
    const targetBtn = mode === 'bulk' ? pipelineBulkBtn : pipelineRevalidateBtn;
    if (targetBtn) targetBtn.disabled = true;
    if (mode === 'bulk' && typeof window !== 'undefined') {
      const confirmed = window.confirm('Quality Gatesの自動修復を実行し、再検証と差分取得を行います。よろしいですか？');
      if (!confirmed) {
        if (targetBtn) targetBtn.disabled = false;
        setTreeStatus('自動修復をキャンセルしました', 'info');
        return;
      }
    }
    pipelineStatusEl.classList.remove('rules-pipeline__status--error');
    setTreeStatus(mode === 'bulk' ? 'Quality Gatesの一括更新を実行中...' : 'Quality Gatesを再検証中...', 'info');
    try {
      const res = await rulesWatcherApi.revalidate(mode);
      if (!res || !res.success) {
        const message = res?.error || 'Quality Gatesの再検証に失敗しました。';
        pipelineStatusEl.classList.add('rules-pipeline__status--error');
        pipelineStatusEl.innerHTML = escapeHtml(message);
        setTreeStatus(message, 'error');
      } else if (res.event) {
        updatePipelineView(res.event);
        const snapshot = res.event?.pipeline?.lastRun;
        if (snapshot && typeof snapshot.exitCode === 'number') {
          const tone = snapshot.exitCode === 0 ? 'success' : 'warn';
          const label = mode === 'bulk' ? '一括更新' : '再検証';
          setTreeStatus(`Quality Gatesの${label}が完了しました (exit ${snapshot.exitCode})`, tone);
        }
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      pipelineStatusEl.classList.add('rules-pipeline__status--error');
      pipelineStatusEl.innerHTML = escapeHtml(message);
      setTreeStatus('Quality Gatesの再検証でエラーが発生しました', 'error');
    } finally {
      if (targetBtn) targetBtn.disabled = false;
    }
  }

  if (pipelineRevalidateBtn) {
    pipelineRevalidateBtn.addEventListener('click', () => triggerRulesAction('manual'));
  }
  if (pipelineBulkBtn) {
    pipelineBulkBtn.addEventListener('click', () => triggerRulesAction('bulk'));
  }
  if (pipelineScanBtn) {
    pipelineScanBtn.addEventListener('click', async () => {
      if (!rulesWatcherApi || typeof rulesWatcherApi.scan !== 'function') return;
      pipelineScanBtn.disabled = true;
      pipelineStatusEl.classList.remove('rules-pipeline__status--error');
      setTreeStatus('影響ドキュメントを再スキャンしています...', 'info');
      try {
        const res = await rulesWatcherApi.scan();
        if (!res || !res.success) {
          const message = res?.error || '影響スキャンに失敗しました。';
          pipelineStatusEl.classList.add('rules-pipeline__status--error');
          pipelineStatusEl.innerHTML = escapeHtml(message);
          setTreeStatus(message, 'error');
        } else if (res.event) {
          updatePipelineView(res.event);
        }
      } catch (err) {
        console.error('[Docs Navigator] Failed to rescan Quality Gates impacts', err);
        pipelineStatusEl.classList.add('rules-pipeline__status--error');
        pipelineStatusEl.innerHTML = '影響スキャンに失敗しました。';
        setTreeStatus('Quality Gatesの影響スキャンでエラーが発生しました', 'error');
      } finally {
        pipelineScanBtn.disabled = false;
      }
    });
  }

  if (rulesWatcherApi && typeof rulesWatcherApi.getState === 'function') {
    try {
      const res = await rulesWatcherApi.getState();
      if (res && res.success && res.event) {
        updatePipelineView(res.event);
      } else if (res && !res.success && res.error) {
        pipelinePanel.classList.remove('hidden');
        pipelineStatusEl.classList.add('rules-pipeline__status--error');
        pipelineStatusEl.innerHTML = escapeHtml(res.error);
      }
    } catch (err) {
      pipelinePanel.classList.remove('hidden');
      pipelineStatusEl.classList.add('rules-pipeline__status--error');
      pipelineStatusEl.innerHTML = escapeHtml(err && err.message ? err.message : String(err));
    }
    if (rulesWatcherApi && typeof rulesWatcherApi.onEvent === 'function') {
      detachRulesWatcher = rulesWatcherApi.onEvent(updatePipelineView);
    }
  } else {
    pipelinePanel.classList.remove('hidden');
    pipelineStatusEl.classList.add('rules-pipeline__status--error');
    pipelineStatusEl.textContent = 'Quality Gates watcher APIが利用できません。';
    if (pipelineRevalidateBtn) pipelineRevalidateBtn.disabled = true;
    if (pipelineBulkBtn) pipelineBulkBtn.disabled = true;
    if (pipelineScanBtn) pipelineScanBtn.disabled = true;
  }

  window.addEventListener('beforeunload', () => {
    if (typeof detachRulesWatcher === 'function') {
      try { detachRulesWatcher(); } catch (err) { console.warn('[Docs Navigator] Failed to detach rules watcher', err); }
    }
  });

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
        const nextPath = v === 'nexus' ? 'tools/nexus/context.mdc' : '.cursor/context.mdc';
        Promise.resolve(applyRulesWatcherContext(nextPath)).finally(() => location.reload());
      });
    } else {
      // デバッグモードでない場合でも、localStorageから読み込む
      contextPath = contextToUse === 'nexus' ? 'tools/nexus/context.mdc' : '.cursor/context.mdc';
    }
    console.log('[Docs Navigator] Reading context from:', contextPath);
    console.log('[Docs Navigator] contextToUse:', contextToUse, 'isDebug:', isDebug, 'saved:', saved);
    await applyRulesWatcherContext(contextPath);
    let ctxRes = await window.docs.read(contextPath);
    if (!ctxRes.success && contextPath !== 'tools/nexus/context.mdc' && !customContextPath) {
      console.warn('[Docs Navigator] Context read failed, trying Nexus fallback...', ctxRes.error);
      const fallbackPath = 'tools/nexus/context.mdc';
      const fallbackRes = await window.docs.read(fallbackPath);
      if (fallbackRes.success) {
        console.log('[Docs Navigator] Fallback context loaded from Nexus package');
        ctxRes = fallbackRes;
        contextPath = fallbackPath;
        await applyRulesWatcherContext(contextPath);
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
    
    const initialMode = docModePreference.read();
    let currentMode = null;

    function activateMode(nextMode, { skipPersist = false } = {}) {
      const normalized = VALID_DOC_MODES.has(nextMode) ? nextMode : 'tree';
      if (currentMode === normalized && !skipPersist) {
        if (normalized === 'tree') {
          setTreeStatus('Tree構造を解析中...', 'info');
          renderTree();
        }
        return;
      }

      currentMode = normalized;
      modeButtons.forEach(b => {
        const isActive = b.dataset.mode === normalized;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      if (modeDescription) {
        modeDescription.textContent = modeDescriptions[normalized] || '';
      }

      docsMode?.classList.toggle('active', normalized === 'docs');
      featsMode?.classList.toggle('active', normalized === 'feats');
      treeMode?.classList.toggle('active', normalized === 'tree');

      if (!skipPersist) {
        docModePreference.write(normalized);
      }

      if (normalized === 'tree') {
        setTreeStatus('Tree構造を解析中...', 'info');
        renderTree();
      }
    }

    console.log('[Docs Navigator] Initializing mode buttons...', modeButtons.length);
    console.log('[Docs Navigator] Tree elements - treeMode:', !!treeMode, 'treeView:', !!window.treeView, 'treeDirection:', !!treeDirection);

    modeButtons.forEach((btn, idx) => {
      console.log(`[Docs Navigator] Registering listener for button ${idx}:`, btn.dataset.mode);
      btn.addEventListener('click', () => {
        activateMode(btn.dataset.mode || 'tree');
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
    if (categoryOrder.length > 0) renderList(categoryOrder[0]);
    else showDocDetailPlaceholder('カテゴリがありません');

    // Restore previously selected mode (defaults to tree on first launch)
    activateMode(initialMode, { skipPersist: true });
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

  async function validateGates(nodes) {
    if (latestGateResults) {
      console.log('[Docs Navigator] Using cached Quality Gates results', {
        source: latestGateResultsSource,
        timestamp: latestGateResultsTimestamp,
        context: latestGateContextPath
      });
      return latestGateResults;
    }

    if (rulesWatcherApi && typeof rulesWatcherApi.getState === 'function') {
      try {
        console.log('[Docs Navigator] Fetching Quality Gates snapshot from rulesWatcher');
        const res = await rulesWatcherApi.getState();
        if (res && res.success && res.event?.pipeline?.lastRun?.results) {
          const snapshot = res.event.pipeline.lastRun;
          setLatestGateResults(snapshot.results, {
            source: 'getState',
            timestamp: snapshot.timestamp,
            contextPath: snapshot.contextPath || null
          });
          renderGateResults(latestGateResults);
          return latestGateResults;
        }
      } catch (err) {
        console.warn('[Docs Navigator] Failed to fetch Quality Gates snapshot from rulesWatcher', err);
      }
    }

    console.log('[Docs Navigator] Falling back to local Quality Gates validation');
    const local = computeLocalGateResults(nodes);
    setLatestGateResults(local, { source: 'local-compute', timestamp: new Date().toISOString() });
    renderGateResults(latestGateResults);
    return latestGateResults;
  }

  function computeLocalGateResults(nodes) {
    const results = sanitizeGateResults({});
    const validLayers = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];

    for (const [path, node] of nodes) {
      const normalizedPath = normalizeGatePath(path);
      if (!node.layer && !node.upstream.length && !node.downstream.length) {
        results['DOC-01'].push({
          gateId: 'DOC-01',
          path: normalizedPath,
          message: 'Breadcrumbsブロックが見つかりません',
          severity: 'error'
        });
      }
      if (node.layer && !validLayers.includes(node.layer.toUpperCase())) {
        results['DOC-02'].push({
          gateId: 'DOC-02',
          path: normalizedPath,
          layer: node.layer,
          message: `無効なLayer: ${node.layer}`,
          severity: 'error'
        });
      }
      for (const upPath of node.upstream) {
        if (!nodes.has(upPath)) {
          results['DOC-03'].push({
            gateId: 'DOC-03',
            path: normalizedPath,
            link: upPath,
            message: `Upstreamパスが存在しません: ${upPath}`,
            severity: 'error'
          });
        }
      }
      for (const downPath of node.downstream) {
        if (!nodes.has(downPath)) {
          results['DOC-03'].push({
            gateId: 'DOC-03',
            path: normalizedPath,
            link: downPath,
            message: `Downstreamパスが存在しません: ${downPath}`,
            severity: 'error'
          });
        }
      }
    }

    const cycles = detectCycles(nodes);
    results['DOC-04'] = cycles.map(cycle => ({
      ...cycle,
      gateId: 'DOC-04',
      severity: 'warn',
      path: normalizeGatePath(cycle.path)
    }));

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
    const panel = gateResultsPanel || document.getElementById('gate-results');
    if (!panel) return;
    const sanitized = sanitizeGateResults(results);
    const documentViolations = DOCUMENT_GATE_ORDER.map(gateId => ({
      gateId,
      violations: sanitized[gateId] || []
    }));
    const testViolations = TEST_CASE_GATE_ORDER.map(gateId => ({
      gateId,
      violations: sanitized[gateId] || []
    }));

    panel.classList.remove('empty-state');
    panel.innerHTML = '';

    const docGroup = document.createElement('div');
    docGroup.className = 'gate-group';
    docGroup.innerHTML = '<h4 class="gate-group__title">Docs Quality Gates</h4>';
    for (const entry of documentViolations) {
      docGroup.appendChild(renderGateBlock(entry.gateId, entry.violations));
    }

    const tcGroup = document.createElement('div');
    tcGroup.className = 'gate-group';
    tcGroup.innerHTML = '<h4 class="gate-group__title">Test Case Quality Gates</h4>';
    for (const entry of testViolations) {
      tcGroup.appendChild(renderGateBlock(entry.gateId, entry.violations, { showTestActions: true }));
    }

    panel.appendChild(docGroup);
    panel.appendChild(tcGroup);

    panel.querySelectorAll('button[data-action="open"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.getAttribute('data-path');
        if (!path) return;
        try {
          await window.docs.open(path);
        } catch (err) {
          console.warn('[Docs Navigator] Failed to open path from Quality Gates panel', err);
        }
      });
    });

    panel.querySelectorAll('button[data-action="fix"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gate = btn.getAttribute('data-gate');
        const path = btn.getAttribute('data-path');
        generateFixPrompt(gate, path);
      });
    });

    panel.querySelectorAll('button[data-action="execute"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const actionId = btn.getAttribute('data-action-id');
        console.log('[Docs Navigator] Triggered custom Quality Gates action', { actionId, gateResultsSource: latestGateResultsSource });
      });
    });
  }

  function renderGateBlock(gateId, violations, { showTestActions = false } = {}) {
    const worstSeverity = pickWorstSeverity(violations, gateId);
    const status = violations.length === 0 ? 'pass' : severityToStatusClass(worstSeverity).css;
    const statusLabel = violations.length === 0
      ? '✓ PASS'
      : `✗ ${violations.length}件 (${severityToStatusClass(worstSeverity).label})`;

    const gateDiv = document.createElement('div');
    gateDiv.className = `gate-result ${status}`;
    const metaParts = [];
    if (latestGateResultsTimestamp) metaParts.push(`最終更新: ${formatTimestamp(latestGateResultsTimestamp)}`);
    if (latestGateContextPath) metaParts.push(`Context: ${escapeHtml(latestGateContextPath)}`);
    gateDiv.innerHTML = `
      <div class="gate-result__header">
        <strong>${escapeHtml(gateId)}</strong>
        <span class="gate-result__status">${statusLabel}</span>
      </div>
      ${metaParts.length && violations.length === 0 ? `<div class="gate-result__meta">${metaParts.join(' ／ ')}</div>` : ''}
    `;

    if (violations.length > 0) {
      const list = document.createElement('div');
      list.className = 'gate-violations';
      for (const violation of violations) {
        list.appendChild(renderGateViolation(gateId, violation, { showTestActions }));
      }
      gateDiv.appendChild(list);
    }

    return gateDiv;
  }

  function renderGateViolation(gateId, violation, { showTestActions = false } = {}) {
    const container = document.createElement('div');
    container.className = 'gate-violation';
    const severity = getViolationSeverity(violation, gateId);
    const severityInfo = severityToStatusClass(severity);
    const path = violation?.path ? escapeHtml(violation.path) : '(path not provided)';
    const message = violation?.message ? escapeHtml(violation.message) : '詳細情報が不足しています';
    const hintLines = [];
    if (violation?.link) {
      hintLines.push(`リンク: ${escapeHtml(violation.link)}`);
    }
    if (violation?.heading) {
      hintLines.push(`見出し: ${escapeHtml(violation.heading)}`);
    }
    if (Array.isArray(violation?.cycle) && violation.cycle.length) {
      hintLines.push(`循環: ${escapeHtml(violation.cycle.join(' → '))}`);
    }
    if (violation?.layer) {
      hintLines.push(`Layer: ${escapeHtml(violation.layer)}`);
    }
    const hintHtml = hintLines.length ? `<div class="gate-violation__hints">${hintLines.join(' ／ ')}</div>` : '';

    container.innerHTML = `
      <div class="gate-violation__summary">
        <span class="gate-violation__badge gate-violation__badge--${severityInfo.css}">${severityInfo.label}</span>
        <span class="gate-violation__path">${path}</span>
      </div>
      <div class="gate-violation__message">${message}</div>
      ${hintHtml}
      <div class="gate-actions">
        ${violation?.path ? `<button class="btn btn-sm btn-secondary" data-action="open" data-path="${escapeHtml(violation.path)}">Open</button>` : ''}
        <button class="btn btn-sm btn-secondary" data-action="fix" data-gate="${escapeHtml(gateId)}" data-path="${escapeHtml(violation?.path || '')}">Fix Prompt</button>
        ${showTestActions && violation?.action ? `<button class="btn btn-sm btn-secondary" data-action="execute" data-action-id="${escapeHtml(String(violation.action))}">Action</button>` : ''}
      </div>
    `;

    if (showTestActions && Array.isArray(violation?.actions) && violation.actions.length) {
      const actionsList = document.createElement('ul');
      actionsList.className = 'gate-violation__actions-list';
      for (const action of violation.actions) {
        if (!action || typeof action !== 'object') continue;
        const li = document.createElement('li');
        const label = action.label ? escapeHtml(action.label) : 'アクション';
        if (action.command) {
          li.innerHTML = `<code>${escapeHtml(action.command)}</code> — ${label}`;
        } else {
          li.textContent = label;
        }
        actionsList.appendChild(li);
      }
      container.appendChild(actionsList);
    }

    return container;
  }

  function generateFixPrompt(gateId, path) {
    const prompts = {
      'DOC-01': `以下のドキュメントにBreadcrumbsブロックを追加してください。\n\nファイル: ${path}\n\nフォーマット:\n> Breadcrumbs\n> Layer: [STRATEGY|PRD|UX|API|DATA|ARCH|DEVELOPMENT|QA]\n> Upstream: [上位ドキュメントパス or N/A]\n> Downstream: [下位ドキュメントパス or N/A]`,
      'DOC-02': `以下のドキュメントのLayerを修正してください。\n\nファイル: ${path}\n\n有効なLayer: STRATEGY, PRD, UX, API, DATA, ARCH, DEVELOPMENT, QA`,
      'DOC-03': `以下のドキュメントのUpstream/Downstreamパスを修正してください。\n\nファイル: ${path}\n\n存在しないパスを削除または修正してください。`,
      'DOC-04': `以下のドキュメントで循環参照を解消してください。\n\nファイル: ${path}\n\nUpstream/Downstreamリンクを見直し、循環を解消してください。`,
      'DOC-05': `以下のドキュメントの見出し番号を修正してください。\n\nファイル: ${path}\n\n##/### 見出しの章番号が連番になるように整えてください。`,
      'DOC-06': `以下のドキュメントの目次リンクを修正してください。\n\nファイル: ${path}\n\n## 目次 セクションのリンクが本文の見出しアンカーと一致するように更新してください。`,
      'DOC-07': `以下のドキュメント名を命名規則に合わせてください。\n\nファイル: ${path}\n\nレイヤーに対応したファイル名（PRD_xxx.mdc等）へリネームしてください。`,
      'DOC-08': `以下のドキュメントのScopeセクションを補完してください。\n\nファイル: ${path}\n\n「扱う内容」「扱わない内容」が明示されるように箇条書きを追加してください。`,
      'TC-01': `以下のテストケースファイルの命名規則を修正してください。\n\nファイル: ${path}\n\ndocs-navigator-basic.spec.ts のように機能を表すスネークケースで命名してください。`,
      'TC-02': `以下のテストケースの独立性を確保してください。\n\nファイル: ${path}\n\n他テストの状態に依存しないようbeforeEach/afterEachでセットアップとクリーンアップを実装してください。`,
      'TC-03': `以下のテストケースに目的と期待結果をコメントで記述してください。\n\nファイル: ${path}\n\n/** ... */ 形式でドキュメント化してください。`,
      'TC-04': `以下のテストケースで使用するデータをfixtures/配下に移動し、setup/teardownで管理してください。\n\nファイル: ${path}`
    };

    const prompt = prompts[gateId] || '';
    navigator.clipboard.writeText(prompt).then(() => {
      alert('修正プロンプトをコピーしました（Cursor autoに貼り付けてください）');
    }).catch(() => {
      alert(`修正プロンプト:\n\n${prompt}`);
    });
  }

  function addGateIconToNode(nodeDiv, path, gateResults) {
    if (!gateResults) return;
    const sanitized = sanitizeGateResults(gateResults);
    const normalizedPath = normalizeGatePath(path);
    const matched = [];

    for (const gateId of Object.keys(sanitized)) {
      const list = Array.isArray(sanitized[gateId]) ? sanitized[gateId] : [];
      for (const violation of list) {
        if (!violation?.path) continue;
        if (normalizeGatePath(violation.path) === normalizedPath) {
          matched.push({ gateId, violation });
        }
      }
    }

    if (matched.length === 0) return;

    let worst = 'info';
    for (const entry of matched) {
      const severity = getViolationSeverity(entry.violation, entry.gateId);
      if (severity === 'error') {
        worst = 'error';
        break;
      }
      if (severity === 'warn' && worst !== 'error') {
        worst = 'warn';
      } else if (severity === 'info' && worst === 'info') {
        worst = 'info';
      }
    }

    const icon = worst === 'error' ? '⛔' : worst === 'warn' ? '⚠' : 'ℹ';
    const span = document.createElement('span');
    span.className = `tree-node-icon ${worst}`;
    span.textContent = icon;
    span.title = matched.map(entry => entry.gateId).join(', ');
    span.dataset.gateSeverity = worst;
    nodeDiv.querySelector('.tree-node-content').appendChild(span);
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
      gateResultsPanel.textContent = 'Quality Gatesの結果を取得しています...';
    }
    try {
      console.log('[renderTree] Calling parseAllBreadcrumbs()...');
      const nodes = await parseAllBreadcrumbs();
      console.log('[renderTree] parseAllBreadcrumbs returned nodes:', nodes.size);

      const direction = window.treeDirection ? window.treeDirection.value : 'downstream';
      console.log('[renderTree] direction =', direction);
      console.log('[renderTree] Calling buildTree()...');
      for (const node of nodes.values()) {
        node.expanded = expandedPaths.has(node.path);
      }
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
        setTreeStatus('ルートが見つかりません', 'warn');
      } else {
        console.log('renderTree: success, rendered', rootNodes.length, 'root nodes');
        setTreeStatus('Tree view ready', 'success');
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

