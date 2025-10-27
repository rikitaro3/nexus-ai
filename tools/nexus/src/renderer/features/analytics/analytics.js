(function initAnalyticsDashboard() {
  const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'DONE'];
  const STATUS_LABELS = {
    TODO: 'TODO',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
  };

  const statusEl = document.getElementById('analytics-status');
  const contentEl = document.getElementById('analytics-content');
  if (!statusEl || !contentEl) return;

  async function refreshAnalytics() {
    if (!window.analytics || typeof window.analytics.fetchMetrics !== 'function') {
      statusEl.textContent = 'Analytics API is not available in this environment.';
      statusEl.className = 'status status-error';
      return;
    }

    try {
      statusEl.textContent = 'メトリクスを読み込み中...';
      statusEl.className = 'status status-info';
      const res = await window.analytics.fetchMetrics();
      if (!res?.success) {
        throw new Error(res?.error || 'Unknown error');
      }
      const metrics = res.data || {};
      renderProgress(metrics.tasks || {});
      renderDagSummary(metrics.dag || {});
      renderMissingNodes(metrics.dag || {});
      renderGateSummary(metrics.qualityGates || {});
      renderGateHistory(metrics.qualityGates || {});
      const timestamp = metrics.generatedAt ? new Date(metrics.generatedAt).toLocaleString() : new Date().toLocaleString();
      statusEl.textContent = `最終更新: ${timestamp}`;
      statusEl.className = 'status status-success';
      contentEl.classList.remove('hidden');
    } catch (error) {
      console.error('[Analytics] Failed to load metrics', error);
      statusEl.textContent = `Analyticsの読み込みに失敗しました: ${error?.message || error}`;
      statusEl.className = 'status status-error';
    }
  }

  function renderProgress(tasks) {
    const chartEl = document.getElementById('analytics-progress-chart');
    const completionEl = document.getElementById('analytics-progress-completion');
    if (!chartEl || !completionEl) return;
    chartEl.innerHTML = '';
    const total = Number(tasks.total || 0);
    const statusCounts = tasks.statusCounts || {};
    const completionRate = typeof tasks.completionRate === 'number' ? tasks.completionRate : 0;
    const percentText = (completionRate * 100).toFixed(1).replace(/\.0$/, '');
    completionEl.textContent = `${percentText}% 完了 (${statusCounts.DONE || 0} / ${total})`;

    if (!total) {
      const empty = document.createElement('p');
      empty.className = 'analytics-empty';
      empty.textContent = 'タスクデータがまだありません。';
      chartEl.appendChild(empty);
      return;
    }

    for (const status of STATUS_ORDER) {
      const count = Number(statusCounts[status] || 0);
      const percent = total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
      const row = document.createElement('div');
      row.className = 'analytics-progress-row';
      const label = document.createElement('span');
      label.className = 'analytics-progress-label';
      label.textContent = STATUS_LABELS[status] || status;
      const bar = document.createElement('div');
      bar.className = 'analytics-progress-bar';
      const fill = document.createElement('div');
      fill.className = `analytics-progress-fill analytics-progress-${status.toLowerCase()}`;
      fill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
      bar.appendChild(fill);
      const value = document.createElement('span');
      value.className = 'analytics-progress-value';
      value.textContent = `${count} (${percent.toFixed(1).replace(/\.0$/, '')}%)`;
      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(value);
      chartEl.appendChild(row);
    }
  }

  function renderDagSummary(dag) {
    const summaryEl = document.getElementById('analytics-dag-summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';
    const total = Number(dag.totalNodes || 0);
    const layers = dag.layers || {};

    const header = document.createElement('p');
    header.innerHTML = `<strong>ノード総数:</strong> ${total}`;
    summaryEl.appendChild(header);

    const layerEntries = Object.entries(layers)
      .sort((a, b) => b[1] - a[1]);

    if (layerEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analytics-empty';
      empty.textContent = 'Layer情報が見つかりません。';
      summaryEl.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'analytics-list';
      for (const [layer, count] of layerEntries) {
        const item = document.createElement('li');
        item.innerHTML = `<span>${layer}</span><span>${count}</span>`;
        list.appendChild(item);
      }
      summaryEl.appendChild(list);
    }

    const orphanCount = Array.isArray(dag.orphanCandidates) ? dag.orphanCandidates.length : 0;
    const orphanInfo = document.createElement('p');
    orphanInfo.innerHTML = `<strong>Orphan候補:</strong> ${orphanCount}`;
    summaryEl.appendChild(orphanInfo);
  }

  function renderMissingNodes(dag) {
    const listEl = document.getElementById('analytics-missing-nodes');
    if (!listEl) return;
    listEl.innerHTML = '';
    const missing = Array.isArray(dag.missingNodes) ? dag.missingNodes : [];

    if (missing.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analytics-empty';
      empty.textContent = '欠損ノードはありません。';
      listEl.appendChild(empty);
      return;
    }

    const maxItems = 20;
    const limited = missing.slice(0, maxItems);
    for (const item of limited) {
      const entry = document.createElement('div');
      entry.className = 'analytics-missing-item';
      const gate = item.gateId || 'N/A';
      entry.innerHTML = `
        <div class="analytics-missing-path">${escapeHtml(item.path || '(不明)')}</div>
        <div class="analytics-missing-meta">${escapeHtml(item.message || '')} / Gate: ${gate}</div>
      `;
      listEl.appendChild(entry);
    }

    if (missing.length > maxItems) {
      const note = document.createElement('p');
      note.className = 'analytics-note';
      note.textContent = `他 ${missing.length - maxItems} 件はエクスポートJSONで確認してください。`;
      listEl.appendChild(note);
    }
  }

  function renderGateSummary(qualityGates) {
    const summaryEl = document.getElementById('analytics-gate-summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';
    const passRate = typeof qualityGates.passRate === 'number' ? qualityGates.passRate : 0;
    const gates = qualityGates.gates || {};

    const headline = document.createElement('p');
    headline.innerHTML = `<strong>Pass Rate:</strong> ${(passRate * 100).toFixed(1).replace(/\.0$/, '')}%`;
    summaryEl.appendChild(headline);

    const gateList = document.createElement('ul');
    gateList.className = 'analytics-list';
    for (const [gateId, info] of Object.entries(gates)) {
      const item = document.createElement('li');
      const violations = info?.violationCount ?? 0;
      item.innerHTML = `<span>${gateId}</span><span>${violations}</span>`;
      gateList.appendChild(item);
    }
    summaryEl.appendChild(gateList);
  }

  function renderGateHistory(qualityGates) {
    const historyEl = document.getElementById('analytics-gate-history');
    if (!historyEl) return;
    historyEl.innerHTML = '';
    const history = Array.isArray(qualityGates.history) ? qualityGates.history.slice(-10).reverse() : [];
    const gateIds = Object.keys(qualityGates.gates || {}).sort();

    if (history.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analytics-empty';
      empty.textContent = '履歴データがまだありません。';
      historyEl.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'analytics-history-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const baseHeaders = ['日時', 'Pass Rate'];
    for (const label of baseHeaders) {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    }
    const effectiveGateIds = gateIds.length > 0 ? gateIds : ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-07', 'DOC-08'];
    for (const gateId of effectiveGateIds) {
      const th = document.createElement('th');
      th.textContent = gateId;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const entry of history) {
      const row = document.createElement('tr');
      const totals = entry.violationTotals || {};
      const cells = [
        escapeHtml(new Date(entry.timestamp).toLocaleString()),
        `${(Number(entry.passRate) * 100).toFixed(1).replace(/\.0$/, '')}%`
      ];
      for (const gateId of effectiveGateIds) {
        cells.push(String(totals[gateId] ?? 0));
      }
      row.innerHTML = cells.map((value, index) => (index < 2 ? `<td>${value}</td>` : `<td>${escapeHtml(value)}</td>`)).join('');
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    historyEl.appendChild(table);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  document.getElementById('analytics-refresh')?.addEventListener('click', () => {
    refreshAnalytics();
  });

  document.getElementById('analytics-export')?.addEventListener('click', async () => {
    if (!window.analytics || typeof window.analytics.exportMetrics !== 'function') {
      alert('Analytics export is not available.');
      return;
    }
    try {
      const res = await window.analytics.exportMetrics();
      if (!res?.success) {
        throw new Error(res?.error || 'Export failed');
      }
      alert(`Analytics JSONを出力しました: ${res.target}`);
    } catch (error) {
      console.error('[Analytics] Export failed', error);
      alert(`Analyticsのエクスポートに失敗しました: ${error?.message || error}`);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshAnalytics);
  } else {
    refreshAnalytics();
  }
})();
