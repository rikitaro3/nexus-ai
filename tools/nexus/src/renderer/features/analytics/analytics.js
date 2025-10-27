(function initAnalyticsDashboard() {
  const root = document.getElementById('analytics');
  if (!root) return;

  const refreshBtn = root.querySelector('[data-role="refresh"]');
  const exportBtn = root.querySelector('[data-role="export"]');
  const statusEl = root.querySelector('[data-role="status"]');
  const updatedEl = root.querySelector('[data-role="updated"]');
  const contextEl = root.querySelector('[data-role="context"]');
  const progressEl = root.querySelector('[data-role="progress"]');
  const statusSummaryEl = root.querySelector('[data-role="status-summary"]');
  const missingEl = root.querySelector('[data-role="missing"]');
  const trendEl = root.querySelector('[data-role="trend"]');
  const warningsEl = root.querySelector('[data-role="warnings"]');

  let latestDataset = null;
  let detachWatcher = null;
  let refreshTimer = null;

  function setStatus(message, tone) {
    if (!statusEl) return;
    if (!message) {
      statusEl.classList.add('hidden');
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = message;
    statusEl.className = `status status-${tone || 'info'}`;
    statusEl.classList.remove('hidden');
  }

  function formatTimestamp(iso) {
    if (!iso) return '-';
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString('ja-JP', { hour12: false });
    } catch (error) {
      console.warn('[Analytics] Failed to format timestamp', iso, error);
      return iso;
    }
  }

  function renderProgress(dataset) {
    if (!progressEl) return;
    progressEl.innerHTML = '';

    const tasks = dataset?.tasks || { total: 0, completed: 0, completionRate: 0 };
    const percentage = Math.round((tasks.completionRate ?? 0) * 100);

    const bar = document.createElement('div');
    bar.className = 'analytics-progress__bar';
    const fill = document.createElement('div');
    fill.className = 'analytics-progress__fill';
    fill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    fill.setAttribute('aria-valuenow', String(percentage));
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.title = `Completed ${tasks.completed} / ${tasks.total} (${percentage}%)`;
    bar.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'analytics-progress__label';
    label.textContent = `${tasks.completed} / ${tasks.total} tasks completed (${percentage}%)`;

    progressEl.appendChild(bar);
    progressEl.appendChild(label);

    if (statusSummaryEl) {
      const entries = Object.entries(tasks.byStatus || {});
      if (entries.length === 0) {
        statusSummaryEl.textContent = 'タスクデータがありません。';
      } else {
        statusSummaryEl.innerHTML = entries
          .map(([status, count]) => `<span class="badge">${status}: ${count}</span>`)
          .join('');
      }
    }
  }

  function renderMissingNodes(dataset) {
    if (!missingEl) return;
    missingEl.innerHTML = '';
    const missingNodes = dataset?.dag?.missingNodes || [];

    if (!missingNodes.length) {
      missingEl.innerHTML = '<p class="analytics-empty">欠損ノードは検出されていません。</p>';
      return;
    }

    const list = document.createElement('ul');
    list.className = 'analytics-missing__list';
    missingNodes.slice(0, 12).forEach(node => {
      const item = document.createElement('li');
      const category = node.category ? ` <span class="analytics-missing__category">${node.category}</span>` : '';
      const message = node.message ? `<span class="analytics-missing__message">${node.message}</span>` : '';
      item.innerHTML = `<code>${node.path}</code>${category}${message}`;
      list.appendChild(item);
    });
    if (missingNodes.length > 12) {
      const footer = document.createElement('p');
      footer.className = 'analytics-missing__more';
      footer.textContent = `他 ${missingNodes.length - 12} 件の欠損ノードがあります。`;
      missingEl.appendChild(list);
      missingEl.appendChild(footer);
    } else {
      missingEl.appendChild(list);
    }
  }

  function renderTrend(dataset) {
    if (!trendEl) return;
    trendEl.innerHTML = '';
    const entries = dataset?.history?.qualityGateViolations || [];
    if (!entries.length) {
      trendEl.innerHTML = '<p class="analytics-empty">Quality Gate履歴が見つかりません。</p>';
      return;
    }

    const width = Math.max(320, entries.length * 40);
    const height = 180;
    const maxValue = entries.reduce((max, entry) => Math.max(max, entry.totalViolations), 0) || 1;
    const padding = 24;
    const pointSpacing = entries.length > 1 ? (width - padding * 2) / (entries.length - 1) : 0;

    const points = entries.map((entry, index) => {
      const x = padding + pointSpacing * index;
      const normalized = entry.totalViolations / maxValue;
      const y = height - padding - normalized * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'analytics-trend__chart');

    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', String(padding));
    axis.setAttribute('y1', String(height - padding));
    axis.setAttribute('x2', String(width - padding + 4));
    axis.setAttribute('y2', String(height - padding));
    axis.setAttribute('class', 'analytics-trend__axis');
    svg.appendChild(axis);

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('class', 'analytics-trend__line');
    svg.appendChild(polyline);

    entries.forEach((entry, index) => {
      const x = padding + pointSpacing * index;
      const normalized = entry.totalViolations / maxValue;
      const y = height - padding - normalized * (height - padding * 2);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '4');
      circle.setAttribute('class', 'analytics-trend__point');
      circle.setAttribute('data-index', String(index));
      svg.appendChild(circle);
    });

    const legend = document.createElement('div');
    legend.className = 'analytics-trend__legend';
    const list = document.createElement('ol');
    list.className = 'analytics-trend__legend-list';

    entries.slice(0, 12).forEach(entry => {
      const item = document.createElement('li');
      item.innerHTML = `<span class="analytics-trend__legend-time">${formatTimestamp(entry.timestamp)}</span>` +
        `<span class="analytics-trend__legend-count">違反 ${entry.totalViolations}</span>` +
        `<span class="analytics-trend__legend-meta">exit ${entry.exitCode} / ${entry.mode}</span>`;
      list.appendChild(item);
    });

    legend.appendChild(list);
    trendEl.appendChild(svg);
    trendEl.appendChild(legend);

    if (entries.length > 12) {
      const footer = document.createElement('p');
      footer.className = 'analytics-trend__more';
      footer.textContent = `他 ${entries.length - 12} 件の履歴があります。`;
      trendEl.appendChild(footer);
    }
  }

  function renderWarnings(dataset) {
    if (!warningsEl) return;
    warningsEl.innerHTML = '';
    const warnings = [];
    (dataset?.tasks?.warnings || []).forEach(msg => warnings.push({ source: 'tasks.json', message: msg }));
    (dataset?.dag?.warnings || []).forEach(msg => warnings.push({ source: 'context.mdc', message: msg }));

    if (!warnings.length) {
      return;
    }

    const list = document.createElement('ul');
    list.className = 'analytics-warnings__list';
    warnings.forEach(entry => {
      const item = document.createElement('li');
      item.innerHTML = `<strong>${entry.source}:</strong> ${entry.message}`;
      list.appendChild(item);
    });
    warningsEl.appendChild(list);
  }

  function renderDataset(dataset) {
    latestDataset = dataset;
    if (updatedEl) {
      updatedEl.textContent = formatTimestamp(dataset?.generatedAt);
    }
    if (contextEl) {
      contextEl.textContent = dataset?.contextPath || '(auto)';
    }
    renderProgress(dataset);
    renderMissingNodes(dataset);
    renderTrend(dataset);
    renderWarnings(dataset);
  }

  async function fetchDataset() {
    if (!window.analytics || typeof window.analytics.getSnapshot !== 'function') {
      setStatus('Analytics APIが利用できません。', 'error');
      return;
    }

    setStatus('メトリクスを取得中...', 'info');
    try {
      const res = await window.analytics.getSnapshot();
      if (!res || res.success !== true) {
        throw new Error(res?.error || 'Unknown error');
      }
      renderDataset(res.data);
      setStatus('最新メトリクスを取得しました。', 'success');
    } catch (error) {
      console.error('[Analytics] Failed to load dataset', error);
      setStatus('メトリクスの取得に失敗しました。', 'error');
    }
  }

  async function handleExport() {
    if (!window.analytics || typeof window.analytics.exportJson !== 'function') {
      setStatus('JSONエクスポートAPIが利用できません。', 'error');
      return;
    }

    setStatus('JSONを生成しています...', 'info');
    try {
      const res = await window.analytics.exportJson();
      if (!res || res.success !== true || !res.json) {
        throw new Error(res?.error || 'Unknown error');
      }
      const blob = new Blob([res.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const timestamp = new Date().toISOString().replace(/[:]/g, '-');
      anchor.download = `nexus-analytics-${timestamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setStatus('JSONをダウンロードしました。', 'success');
    } catch (error) {
      console.error('[Analytics] Failed to export dataset', error);
      setStatus('JSONのエクスポートに失敗しました。', 'error');
    }
  }

  function scheduleAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      fetchDataset();
    }, 1500);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchDataset();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }

  if (window.rulesWatcher && typeof window.rulesWatcher.onEvent === 'function') {
    detachWatcher = window.rulesWatcher.onEvent(() => {
      scheduleAutoRefresh();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (detachWatcher) {
      detachWatcher();
      detachWatcher = null;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  });

  fetchDataset();
})();
