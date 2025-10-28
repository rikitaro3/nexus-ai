'use client';

import { useEffect, useMemo, useState } from 'react';

interface ContextEntry {
  category: string;
  path: string;
  description: string;
}

type Mode = 'docs' | 'feats' | 'tree';

const DEFAULT_CONTEXT_PATH = '/context.mdc';

function extractSection(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const tail = source.slice(start + marker.length);
  const nextHeading = tail.indexOf('\n## ');
  if (nextHeading === -1) {
    return tail.trim();
  }
  return tail.slice(0, nextHeading).trim();
}

function parseContextEntries(raw: string): ContextEntry[] {
  const section = extractSection(raw, '## Context Map');
  if (!section) return [];
  const lines = section.split('\n');
  const entries: ContextEntry[] = [];
  let currentCategory = '';
  for (const line of lines) {
    if (line.startsWith('### ')) {
      currentCategory = line.replace(/^###\s+/, '').trim();
      continue;
    }
    const match = line.match(/^-\s+([^\s].*?)\s+…\s+(.*)$/u);
    if (match && currentCategory) {
      entries.push({
        category: currentCategory,
        path: match[1].trim(),
        description: match[2].trim(),
      });
    }
  }
  return entries;
}

function uniqueCategories(entries: ContextEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.category && !seen.has(entry.category)) {
      seen.add(entry.category);
    }
  }
  return Array.from(seen);
}

export default function DocsNavigator() {
  const [mode, setMode] = useState<Mode>('docs');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(DEFAULT_CONTEXT_PATH);
        if (!res.ok) {
          throw new Error(`Failed to load context (${res.status})`);
        }
        const text = await res.text();
        if (cancelled) return;
        const parsed = parseContextEntries(text);
        setEntries(parsed);
        if (parsed.length) {
          const firstCat = parsed[0].category;
          setSelectedCategory(firstCat);
          setSelectedPath(parsed[0].path);
        }
      } catch (err) {
        console.error('[DocsNavigator] Failed to load context', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadContext();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => uniqueCategories(entries), [entries]);

  const filteredEntries = useMemo(() => {
    if (!selectedCategory) return [];
    const lower = search.trim().toLowerCase();
    return entries.filter(entry => {
      if (entry.category !== selectedCategory) return false;
      if (!lower) return true;
      return (
        entry.path.toLowerCase().includes(lower) ||
        entry.description.toLowerCase().includes(lower)
      );
    });
  }, [entries, selectedCategory, search]);

  const activeEntry = useMemo(
    () => entries.find(entry => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );

  const renderDocsMode = () => (
    <div className="docs-mode" data-testid="docs-navigator__mode-docs">
      <div className="docs-split" data-testid="docs-navigator__docs-split">
        <aside className="docs-left" data-testid="docs-navigator__category-column">
          <div className="form-group">
            <input
              type="text"
              placeholder="検索..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              aria-label="ドキュメント検索"
            />
          </div>
          <h3 data-testid="docs-navigator__category-heading">カテゴリ</h3>
          <ul data-testid="docs-navigator__category-list">
            {categories.map(category => (
              <li
                key={category}
                role="button"
                tabIndex={0}
                className={category === selectedCategory ? 'active' : ''}
                onClick={() => {
                  setSelectedCategory(category);
                  const first = entries.find(entry => entry.category === category);
                  setSelectedPath(first?.path ?? '');
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    setSelectedCategory(category);
                    const first = entries.find(entry => entry.category === category);
                    setSelectedPath(first?.path ?? '');
                  }
                }}
              >
                {category}
              </li>
            ))}
          </ul>
          {categories.length === 0 && !loading && !error && (
            <p className="empty-state" data-testid="docs-navigator__category-empty">
              カテゴリが見つかりません
            </p>
          )}
          {error && (
            <p className="empty-state" data-testid="docs-navigator__category-error">
              読み込みに失敗しました: {error}
            </p>
          )}
        </aside>
        <section className="docs-middle" data-testid="docs-navigator__list-column">
          <h3 data-testid="docs-navigator__list-heading">一覧</h3>
          <ul data-testid="docs-navigator__list">
            {filteredEntries.map(entry => (
              <li
                key={entry.path}
                className={entry.path === selectedPath ? 'active' : ''}
                onClick={() => setSelectedPath(entry.path)}
              >
                <strong>{entry.path.split('/').pop()}</strong>
                <span>{entry.description}</span>
              </li>
            ))}
          </ul>
          {filteredEntries.length === 0 && !loading && (
            <p className="empty-state" data-testid="docs-navigator__list-empty">
              選択されたカテゴリにドキュメントがありません
            </p>
          )}
        </section>
        <section className="docs-right" data-testid="docs-navigator__detail-column">
          <h3 data-testid="docs-navigator__detail-heading">詳細</h3>
          {activeEntry ? (
            <div className="docs-detail" data-testid="docs-navigator__detail">
              <p className="docs-detail__path">
                <span className="docs-detail__label">Path:</span>
                <code>{activeEntry.path}</code>
              </p>
              <p className="docs-detail__description">{activeEntry.description}</p>
              <div className="control-group">
                <a className="btn btn-secondary" href={activeEntry.path} target="_blank" rel="noreferrer">
                  ドキュメントを開く
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigator.clipboard?.writeText(activeEntry.path)}
                >
                  パスをコピー
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-state" data-testid="docs-navigator__detail-empty">
              ドキュメントが選択されていません
            </p>
          )}
        </section>
      </div>
    </div>
  );

  const renderPlaceholder = (testId: string, title: string) => (
    <div className="empty-state" data-testid={testId}>
      {title} 機能は順次実装予定です。
    </div>
  );

  return (
    <section className="card" data-testid="docs-navigator__section">
      <h2 data-testid="docs-navigator__heading">📚 Docs Navigator</h2>
      <div className="docs-mode-bar" role="toolbar" data-testid="docs-navigator__mode-toolbar">
        <div className="docs-mode-buttons" data-testid="docs-navigator__mode-buttons">
          <button
            type="button"
            className={`btn btn-secondary docs-mode-btn${mode === 'docs' ? ' active' : ''}`}
            onClick={() => setMode('docs')}
            data-testid="docs-navigator__mode-docs-button"
          >
            Docs
          </button>
          <button
            type="button"
            className={`btn btn-secondary docs-mode-btn${mode === 'feats' ? ' active' : ''}`}
            onClick={() => setMode('feats')}
            data-testid="docs-navigator__mode-feats-button"
          >
            FEATs
          </button>
          <button
            type="button"
            className={`btn btn-secondary docs-mode-btn${mode === 'tree' ? ' active' : ''}`}
            onClick={() => setMode('tree')}
            data-testid="docs-navigator__mode-tree-button"
          >
            Tree
          </button>
        </div>
        <div className="docs-mode-meta" data-testid="docs-navigator__mode-description-wrap">
          <span id="docs-mode-description" data-testid="docs-navigator__mode-description">
            {mode === 'docs'
              ? 'コンテキストマップからカテゴリ別にドキュメントを検索できます'
              : mode === 'feats'
                ? 'FEATs レジストリのブラウズは近日公開予定です'
                : 'Tree ビューは近日公開予定です'}
          </span>
        </div>
      </div>
      {loading && (
        <p className="text-muted" data-testid="docs-navigator__loading">
          コンテキストを読み込み中...
        </p>
      )}
      {!loading && mode === 'docs' && renderDocsMode()}
      {!loading && mode === 'feats' && renderPlaceholder('docs-navigator__mode-feats', 'FEATs')}
      {!loading && mode === 'tree' && renderPlaceholder('docs-navigator__mode-tree', 'Tree')}
    </section>
  );
}
