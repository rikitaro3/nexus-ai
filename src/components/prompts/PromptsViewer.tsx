'use client';

import type { PromptDictionary } from '@/types/prompts';
import { useEffect, useMemo, useState } from 'react';

export default function PromptsViewer() {
  const [dictionary, setDictionary] = useState<PromptDictionary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadPrompts() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/prompts');
        if (!res.ok) {
          throw new Error(`Failed to load prompts (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setDictionary(data);
        if (data.categories?.length > 0) {
          setSelectedCategory(data.categories[0].id);
          if (data.categories[0].items?.length > 0) {
            setSelectedPromptId(data.categories[0].items[0].id);
          }
        }
      } catch (err) {
        console.error('[PromptsViewer] Failed to load prompts', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadPrompts();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => dictionary?.categories ?? [], [dictionary]);

  const activeCategory = useMemo(
    () => categories.find(cat => cat.id === selectedCategory) ?? null,
    [categories, selectedCategory]
  );

  const filteredItems = useMemo(() => {
    if (!activeCategory) return [];
    const lower = search.trim().toLowerCase();
    if (!lower) return activeCategory.items;
    return activeCategory.items.filter(
      item =>
        item.title.toLowerCase().includes(lower) ||
        item.description.toLowerCase().includes(lower) ||
        item.tags.some(tag => tag.toLowerCase().includes(lower))
    );
  }, [activeCategory, search]);

  const selectedPrompt = useMemo(
    () => filteredItems.find(item => item.id === selectedPromptId) ?? null,
    [filteredItems, selectedPromptId]
  );

  const handleCopyPrompt = async () => {
    if (!selectedPrompt?.body) {
      setStatusMessage('プロンプトが選択されていません');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedPrompt.body);
      setStatusMessage('クリップボードにコピーしました');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (error) {
      console.warn('[PromptsViewer] Failed to copy prompt', error);
      setStatusMessage('クリップボードへのコピーに失敗しました');
    }
  };

  if (loading) {
    return (
      <section className="card" data-testid="prompts__section">
        <div className="loading-state">プロンプト辞書を読み込み中...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card" data-testid="prompts__section">
        <div className="error-state">エラー: {error}</div>
      </section>
    );
  }

  return (
    <section className="card" data-testid="prompts__section">
      <div className="prompts-header">
        <h2 className="prompts-title">プロンプト辞書</h2>
        <p className="prompts-description">
          {dictionary?.metadata?.description || 'プロジェクトで使用するプロンプトテンプレート集'}
        </p>
      </div>

      <div className="prompts-layout">
        {/* カテゴリー選択 */}
        <aside className="prompts-sidebar">
          <div className="prompts-categories">
            <h3 className="prompts-sidebar-title">カテゴリー</h3>
            <ul className="prompts-category-list">
              {categories.map(category => (
                <li
                  key={category.id}
                  className={`prompts-category-item${selectedCategory === category.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedCategory(category.id);
                    if (category.items.length > 0) {
                      setSelectedPromptId(category.items[0].id);
                    }
                  }}
                >
                  <span className="prompts-category-label">{category.label}</span>
                  <span className="prompts-category-count">{category.items.length}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* メインコンテンツ */}
        <main className="prompts-main">
          {activeCategory && (
            <>
              <div className="prompts-category-header">
                <h3 className="prompts-category-title">{activeCategory.label}</h3>
                <p className="prompts-category-description">{activeCategory.description}</p>
              </div>

              <div className="prompts-search">
                <input
                  type="text"
                  className="prompts-search-input"
                  placeholder="プロンプトを検索..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="prompts-content">
                {/* プロンプト一覧 */}
                <div className="prompts-list">
                  {filteredItems.map(item => (
                    <div
                      key={item.id}
                      className={`prompts-item${selectedPromptId === item.id ? ' active' : ''}`}
                      onClick={() => setSelectedPromptId(item.id)}
                    >
                      <h4 className="prompts-item-title">{item.title}</h4>
                      <p className="prompts-item-description">{item.description}</p>
                      {item.tags.length > 0 && (
                        <div className="prompts-item-tags">
                          {item.tags.map(tag => (
                            <span key={tag} className="prompts-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredItems.length === 0 && (
                    <div className="prompts-empty">該当するプロンプトが見つかりません</div>
                  )}
                </div>

                {/* プロンプト詳細 */}
                <div className="prompts-detail">
                  {selectedPrompt ? (
                    <>
                      <div className="prompts-detail-header">
                        <h4 className="prompts-detail-title">{selectedPrompt.title}</h4>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleCopyPrompt}
                        >
                          コピー
                        </button>
                      </div>
                      <p className="prompts-detail-description">{selectedPrompt.description}</p>
                      <div className="prompts-detail-body">
                        <pre>{selectedPrompt.body}</pre>
                      </div>
                      {selectedPrompt.tags.length > 0 && (
                        <div className="prompts-detail-tags">
                          <strong>タグ:</strong>
                          {selectedPrompt.tags.map(tag => (
                            <span key={tag} className="prompts-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="prompts-detail-empty">
                      プロンプトを選択してください
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {statusMessage && <p className="text-muted prompts-status">{statusMessage}</p>}
    </section>
  );
}

