'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';

import DocumentDetailPanel, { type DetailPanelData } from '@/components/docs/DocumentDetailPanel';
import DocumentViewer from './DocumentViewer';
import DiagnosisModal from './DiagnosisModal';
import { parseContextEntries, type ContextEntry } from '@/lib/docs/context';
import { extractDocumentMetadata, type DocumentMetadata } from '@/lib/docs/metadata';
import { parseFeatRegistry, searchByFeatId, type FeatureRecord } from '@/lib/docs/featRegistry';

interface TreeNode extends DocumentMetadata {
  children: TreeNode[];
  expanded: boolean;
  isOrphan: boolean;
}

type Mode = 'docs' | 'feats' | 'tree';

const DEFAULT_CONTEXT_PATH = '/context.mdc';
const FEAT_REGISTRY_PATH = 'docs/PRD/要求仕様書.mdc';

interface FeatureDocumentSummary {
  path: string;
  title: string;
  layer: string | null;
  description?: string;
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

/**
 * ドキュメントのYAMLフロントマターを取得してメタデータを返す
 */
async function fetchDocumentMetadata(path: string): Promise<DocumentMetadata | null> {
  try {
    const response = await fetch(`/api/docs?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      console.warn(`[fetchDocumentMetadata] Failed to fetch ${path}: ${response.status}`);
      return null;
    }
    const text = await response.text();
    return extractDocumentMetadata(text, path);
  } catch (error) {
    console.error(`[fetchDocumentMetadata] Error fetching ${path}:`, error);
    return null;
  }
}

/**
 * ドキュメントメタデータの配列からツリー構造を構築
 */
function buildTree(documents: DocumentMetadata[]): TreeNode[] {
  const docMap = new Map<string, DocumentMetadata>();
  documents.forEach(doc => docMap.set(doc.path, doc));
  
  // ルートノードを見つける（upstreamが空のドキュメント）
  const roots = documents.filter(doc => doc.upstream.length === 0);
  
  // 再帰的にツリーノードを構築
  function buildTreeNode(doc: DocumentMetadata, visited = new Set<string>()): TreeNode {
    // 循環参照チェック
    if (visited.has(doc.path)) {
      console.warn(`[buildTree] Circular reference detected: ${doc.path}`);
      return {
        ...doc,
        children: [],
        expanded: false,
        isOrphan: false,
      };
    }
    
    visited.add(doc.path);
    
    const children: TreeNode[] = [];
    for (const downPath of doc.downstream) {
      const childDoc = docMap.get(downPath);
      if (childDoc) {
        children.push(buildTreeNode(childDoc, new Set(visited)));
      }
    }
    
    return {
      ...doc,
      children,
      expanded: false,
      isOrphan: false,
    };
  }
  
  return roots.map(root => buildTreeNode(root));
}

/**
 * ツリーに含まれないドキュメント（オーファン）を検出
 */
function findOrphans(documents: DocumentMetadata[], treeNodes: TreeNode[]): DocumentMetadata[] {
  const inTree = new Set<string>();
  
  function collectPaths(node: TreeNode) {
    inTree.add(node.path);
    node.children.forEach(collectPaths);
  }
  
  treeNodes.forEach(collectPaths);
  
  return documents.filter(doc => !inTree.has(doc.path));
}

export default function DocsNavigator() {
  const [mode, setMode] = useState<Mode>('docs');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [search, setSearch] = useState('');
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [featLoading, setFeatLoading] = useState(false);
  const [featError, setFeatError] = useState<string | null>(null);
  const [featSearch, setFeatSearch] = useState('');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [featureDocMap, setFeatureDocMap] = useState<Record<string, FeatureDocumentSummary[]>>({});
  const [featureDocLoading, setFeatureDocLoading] = useState(false);
  const [featureDocError, setFeatureDocError] = useState<string | null>(null);

  // Tree mode states
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [orphans, setOrphans] = useState<DocumentMetadata[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState<TreeNode | DocumentMetadata | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [metadataMap, setMetadataMap] = useState<Partial<Record<string, DocumentMetadata | null>>>({});
  const [docContentCache, setDocContentCache] = useState<Record<string, string>>({});
  
  // DocumentViewer states
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  
  // Quality Gates states
  const [qualityGateStatus, setQualityGateStatus] = useState<string>('');
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      setLoading(true);
      setError(null);
      try {
        console.log('[DocsNavigator] Fetching context from:', DEFAULT_CONTEXT_PATH);
        const res = await fetch(DEFAULT_CONTEXT_PATH);
        if (!res.ok) {
          throw new Error(`Failed to load context (${res.status})`);
        }
        const text = await res.text();
        console.log('[DocsNavigator] Context loaded, length:', text.length);
        console.log('[DocsNavigator] Context preview:', text.substring(0, 100));
        if (cancelled) return;
        const parsed = parseContextEntries(text);
        console.log('[DocsNavigator] Total parsed entries:', parsed.length);
        console.log('[DocsNavigator] Categories:', uniqueCategories(parsed));
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

  useEffect(() => {
    if (mode !== 'feats') return;
    if (features.length > 0 || featLoading) return;

    let cancelled = false;

    async function loadFeatRegistry() {
      setFeatLoading(true);
      setFeatError(null);

      try {
        const response = await fetch(`/api/docs?path=${encodeURIComponent(FEAT_REGISTRY_PATH)}`);
        if (!response.ok) {
          throw new Error(`Failed to load feat registry (${response.status})`);
        }

        const text = await response.text();
        if (cancelled) return;

        const parsed = parseFeatRegistry(text);
        setFeatures(parsed);
      } catch (error) {
        console.error('[DocsNavigator] Failed to load feat registry', error);
        if (!cancelled) {
          setFeatError(error instanceof Error ? error.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setFeatLoading(false);
        }
      }
    }

    loadFeatRegistry();

    return () => {
      cancelled = true;
    };
  }, [mode, features.length, featLoading]);

  useEffect(() => {
    if (features.length === 0) return;
    if (selectedFeatureId) return;

    setSelectedFeatureId(features[0].id);
  }, [features, selectedFeatureId]);

  useEffect(() => {
    if (!selectedFeatureId) return;
    if (featureDocMap[selectedFeatureId]) {
      setFeatureDocError(null);
    }
  }, [selectedFeatureId, featureDocMap]);

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

  const filteredFeatures = useMemo(
    () => searchByFeatId(features, featSearch),
    [features, featSearch],
  );

  const activeFeature = useMemo(
    () => features.find(feature => feature.id === selectedFeatureId) ?? null,
    [features, selectedFeatureId],
  );

  const relatedDocs = selectedFeatureId ? featureDocMap[selectedFeatureId] ?? [] : [];
  const isRelatedDocsLoading = featureDocLoading && (!selectedFeatureId || !featureDocMap[selectedFeatureId]);

  const metadataForSelectedPath = selectedPath ? metadataMap[selectedPath] : undefined;

  useEffect(() => {
    if (!selectedPath) return;
    if (metadataForSelectedPath !== undefined) return;

    let cancelled = false;

    async function loadMetadata() {
      const result = await fetchDocumentMetadata(selectedPath);
      if (cancelled) return;
      setMetadataMap(prev => ({ ...prev, [selectedPath]: result }));
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [selectedPath, metadataForSelectedPath]);

  useEffect(() => {
    if (!selectedFeatureId) return;
    if (featureDocMap[selectedFeatureId]) return;

    const targetFeatureId = selectedFeatureId;
    let cancelled = false;

    async function loadRelatedDocs() {
      setFeatureDocLoading(true);
      setFeatureDocError(null);

      const normalized = targetFeatureId.toLowerCase();
      const related: FeatureDocumentSummary[] = [];
      const newContents: Record<string, string> = {};
      const newMetadata: Partial<Record<string, DocumentMetadata | null>> = {};
      const seen = new Set<string>();

      for (const entry of entries) {
        if (cancelled) return;

        const description = entry.description ?? '';
        let matched = description.toLowerCase().includes(normalized);
        let content = docContentCache[entry.path];

        if (!matched) {
          if (content === undefined) {
            try {
              const response = await fetch(`/api/docs?path=${encodeURIComponent(entry.path)}`);
              if (!response.ok) {
                console.warn('[DocsNavigator] Failed to load document for FEAT search:', entry.path, response.status);
              } else {
                const text = await response.text();
                if (cancelled) return;
                newContents[entry.path] = text;
                content = text;
              }
            } catch (error) {
              console.error('[DocsNavigator] Error loading document for FEAT search:', entry.path, error);
            }
          }

          if (content) {
            matched = content.toLowerCase().includes(normalized);
          }
        }

        if (!matched || seen.has(entry.path)) {
          continue;
        }

        seen.add(entry.path);

        let metadata = metadataMap[entry.path];
        if (metadata === undefined) {
          const fetched = await fetchDocumentMetadata(entry.path);
          if (cancelled) return;
          newMetadata[entry.path] = fetched ?? null;
          metadata = fetched ?? null;
        }

        const finalMetadata = metadata ?? null;

        related.push({
          path: entry.path,
          title: finalMetadata?.title ?? entry.path.split('/').pop() ?? entry.path,
          layer: finalMetadata?.layer ?? null,
          description: entry.description,
        });
      }

      if (cancelled) return;

      if (Object.keys(newContents).length > 0) {
        setDocContentCache(prev => ({ ...prev, ...newContents }));
      }

      if (Object.keys(newMetadata).length > 0) {
        setMetadataMap(prev => ({ ...prev, ...newMetadata }));
      }

      setFeatureDocMap(prev => ({ ...prev, [targetFeatureId]: related }));
      setFeatureDocLoading(false);
    }

    loadRelatedDocs().catch(error => {
      console.error('[DocsNavigator] Failed to resolve related documents', error);
      if (!cancelled) {
        setFeatureDocError(error instanceof Error ? error.message : 'Unknown error');
        setFeatureDocLoading(false);
        setFeatureDocMap(prev => ({ ...prev, [targetFeatureId]: [] }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFeatureId, entries, docContentCache, metadataMap, featureDocMap]);

  // Treeモードに切り替わったときにドキュメントをロード
  useEffect(() => {
    if (mode !== 'tree' || entries.length === 0) return;
    
    let cancelled = false;
    
    async function loadTreeData() {
      setTreeLoading(true);
      console.log('[TreeView] Loading document metadata...');
      
      try {
        // すべてのドキュメントのメタデータを取得
        const metadataPromises = entries.map(entry => fetchDocumentMetadata(entry.path));
        const metadataResults = await Promise.all(metadataPromises);

        if (cancelled) return;

        setMetadataMap(prev => {
          const next = { ...prev } as Partial<Record<string, DocumentMetadata | null>>;
          entries.forEach((entry, index) => {
            next[entry.path] = metadataResults[index] ?? null;
          });
          return next;
        });

        // nullを除外
        const documents = metadataResults.filter((doc): doc is DocumentMetadata => doc !== null);
        console.log('[TreeView] Loaded metadata for', documents.length, 'documents');
        
        // ツリーを構築
        const tree = buildTree(documents);
        console.log('[TreeView] Built tree with', tree.length, 'root nodes');
        
        // オーファンを検出
        const orphanDocs = findOrphans(documents, tree);
        console.log('[TreeView] Found', orphanDocs.length, 'orphans');
        
        setTreeNodes(tree);
        setOrphans(orphanDocs);
        
        // 最初のノードを選択
        if (tree.length > 0) {
          setSelectedTreeNode(tree[0]);
        }
      } catch (err) {
        console.error('[TreeView] Failed to load tree data:', err);
      } finally {
        if (!cancelled) {
          setTreeLoading(false);
        }
      }
    }
    
    loadTreeData();
    
    return () => {
      cancelled = true;
    };
  }, [mode, entries]);

  const buildDetailData = (
    path: string | null,
    fallback?: Partial<DetailPanelData>,
  ): DetailPanelData | null => {
    if (!path) return null;

    const metadata = metadataMap[path];
    const entry = entries.find(item => item.path === path) ?? null;

    return {
      path,
      title: metadata?.title ?? fallback?.title,
      layer: metadata?.layer ?? fallback?.layer,
      upstream: metadata?.upstream ?? fallback?.upstream,
      downstream: metadata?.downstream ?? fallback?.downstream,
      description: entry?.description ?? fallback?.description,
    };
  };

  const renderDocsMode = () => (
    <div className="docs-mode active" data-testid="docs-navigator__mode-docs">
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
          <DocumentDetailPanel
            data={buildDetailData(
              activeEntry?.path ?? null,
              activeEntry
                ? {
                    title: activeEntry.path.split('/').pop(),
                    description: activeEntry.description,
                  }
                : undefined,
            )}
            onOpenDocument={selectedPath => {
              setViewerPath(selectedPath);
              setViewerOpen(true);
            }}
          />
        </section>
      </div>
    </div>
  );

  const renderFeatsMode = () => (
    <div className="docs-mode active" data-testid="docs-navigator__mode-feats">
      <div className="docs-split" data-testid="docs-navigator__feats-split">
        <aside className="docs-left" data-testid="docs-navigator__feats-list">
          <div className="form-group">
            <input
              type="text"
              placeholder="FEAT検索..."
              value={featSearch}
              onChange={event => setFeatSearch(event.target.value)}
              aria-label="FEAT検索"
            />
          </div>

          {featLoading && features.length === 0 ? (
            <p className="text-muted" data-testid="docs-navigator__feats-loading">
              機能一覧を読み込み中...
            </p>
          ) : (
            <ul data-testid="docs-navigator__feats-items">
              {filteredFeatures.map(feature => (
                <li
                  key={feature.id}
                  className={feature.id === selectedFeatureId ? 'active' : ''}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedFeatureId(feature.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setSelectedFeatureId(feature.id);
                    }
                  }}
                >
                  <strong>{feature.id}</strong>
                  <span>{feature.name}</span>
                </li>
              ))}
            </ul>
          )}

          {!featLoading && filteredFeatures.length === 0 && !featError && (
            <p className="empty-state" data-testid="docs-navigator__feats-empty">
              該当するFEATが見つかりません
            </p>
          )}

          {featError && (
            <p className="empty-state" data-testid="docs-navigator__feats-error">
              読み込みに失敗しました: {featError}
            </p>
          )}
        </aside>

        <section className="docs-right" data-testid="docs-navigator__feats-detail">
          {activeFeature ? (
            <div className="docs-detail" data-testid="docs-navigator__feats-detail-content">
              <h3>{activeFeature.name}</h3>
              <dl className="feature-detail__meta">
                <div>
                  <dt>FEAT-ID</dt>
                  <dd>{activeFeature.id}</dd>
                </div>
                <div>
                  <dt>REQ-ID</dt>
                  <dd>{activeFeature.reqId}</dd>
                </div>
                <div>
                  <dt>FR範囲</dt>
                  <dd>{activeFeature.frRange}</dd>
                </div>
                <div>
                  <dt>FR数</dt>
                  <dd>{activeFeature.frCount ?? 'N/A'}</dd>
                </div>
                <div>
                  <dt>優先度</dt>
                  <dd>{activeFeature.priority}</dd>
                </div>
                <div>
                  <dt>ステータス</dt>
                  <dd>{activeFeature.status}</dd>
                </div>
              </dl>

              <div className="feature-detail__related">
                <h4>関連ドキュメント</h4>

                {isRelatedDocsLoading ? (
                  <p className="text-muted" data-testid="docs-navigator__feats-related-loading">
                    関連ドキュメントを検索中...
                  </p>
                ) : featureDocError ? (
                  <p className="empty-state" data-testid="docs-navigator__feats-related-error">
                    関連ドキュメントを取得できませんでした: {featureDocError}
                  </p>
                ) : relatedDocs.length > 0 ? (
                  <ul data-testid="docs-navigator__feats-related-list">
                    {relatedDocs.map(doc => (
                      <li key={doc.path}>
                        <div className="feature-detail__doc-meta">
                          <strong>{doc.title}</strong>
                          {doc.layer && <span className="feature-detail__doc-layer">{doc.layer}</span>}
                          <p className="text-muted">{doc.description ?? '説明が登録されていません'}</p>
                          <code>{doc.path}</code>
                        </div>
                        <div className="control-group">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setViewerPath(doc.path);
                              setViewerOpen(true);
                            }}
                          >
                            ドキュメントを開く
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard?.writeText(doc.path);
                              } catch (error) {
                                console.error('[DocsNavigator] Failed to copy path:', error);
                              }
                            }}
                          >
                            パスをコピー
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state" data-testid="docs-navigator__feats-related-empty">
                    関連するドキュメントは見つかりませんでした
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="empty-state" data-testid="docs-navigator__feats-detail-empty">
              FEATを選択してください
            </p>
          )}
        </section>
      </div>
    </div>
  );

  const renderDetailPanel = (
    target: TreeNode | DocumentMetadata | null,
    options: {
      emptyMessage?: string;
      testId?: string;
    } = {},
  ) => (
    <DocumentDetailPanel
      data={buildDetailData(target?.path ?? null, target ?? undefined)}
      emptyMessage={options.emptyMessage}
      testId={options.testId}
      onOpenDocument={path => {
        setViewerPath(path);
        setViewerOpen(true);
      }}
    />
  );

  const handleToggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Quality Gates handlers
  async function fetchPromptById(promptId: string): Promise<string | null> {
    try {
      const res = await fetch('/api/prompts');
      if (!res.ok) {
        throw new Error(`Failed to fetch prompts (${res.status})`);
      }
      const data = await res.json();
      for (const category of data.categories || []) {
        const item = category.items?.find((i: { id: string; body?: string }) => i.id === promptId);
        if (item) return item.body;
      }
      return null;
    } catch (error) {
      console.error('[DocsNavigator] Failed to fetch prompt', error);
      return null;
    }
  }

  const handleDocumentDiagnosis = () => {
    setDiagnosisModalOpen(true);
  };

  const handleDocumentInventory = async () => {
    setQualityGateStatus('棚卸しプロンプトを取得中...');
    try {
      const prompt = await fetchPromptById('PRM-DOC-11-CHK-001');
      if (prompt) {
        await navigator.clipboard.writeText(prompt);
        setQualityGateStatus('棚卸しプロンプトをコピーしました');
        setTimeout(() => setQualityGateStatus(''), 3000);
      } else {
        setQualityGateStatus('プロンプトが見つかりませんでした');
        setTimeout(() => setQualityGateStatus(''), 3000);
      }
    } catch (error) {
      console.error('[DocsNavigator] Failed to copy inventory prompt', error);
      setQualityGateStatus('コピーに失敗しました');
      setTimeout(() => setQualityGateStatus(''), 3000);
    }
  };

  const renderTreeNode = (node: TreeNode, depth = 0): ReactElement => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedTreeNode?.path === node.path;
    const hasChildren = node.children.length > 0;
    const indent = '  '.repeat(depth);
    const icon = hasChildren ? (isExpanded ? '▼' : '▶') : '';
    const filename = node.path.split('/').pop() || node.path;
    
    return (
      <div key={node.path}>
        <div
          className={`tree-node${isSelected ? ' selected' : ''}`}
          onClick={() => setSelectedTreeNode(node)}
          data-testid={`tree-node-${node.path}`}
        >
          <span className="tree-toggle" onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) handleToggleExpand(node.path);
          }}>
            {indent}{icon && <span className="tree-icon">{icon}</span>}
          </span>
          <span className="tree-layer">{node.layer}</span>
          <span className="tree-filename">{filename}</span>
        </div>
        {hasChildren && isExpanded && (
          <div className="tree-children">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderTreeMode = () => (
    <div className="docs-mode active" data-testid="docs-navigator__mode-tree">
      {treeLoading ? (
        <p className="text-muted">ツリーデータを読み込み中...</p>
      ) : (
        <div className="docs-split" data-testid="docs-navigator__tree-split">
          <aside className="docs-left" data-testid="docs-navigator__tree-view">
            <h3>Document Tree</h3>
            <div className="tree-view">
              {treeNodes.map(node => renderTreeNode(node))}
              {treeNodes.length === 0 && (
                <p className="empty-state">ツリーデータがありません</p>
              )}
            </div>
            
            {orphans.length > 0 && (
              <div className="tree-orphans" data-testid="docs-navigator__orphans">
                <h4 className="tree-orphans-title">Orphans ({orphans.length})</h4>
                <ul>
                  {orphans.map(orphan => (
                    <li
                      key={orphan.path}
                      className={selectedTreeNode?.path === orphan.path ? 'active' : ''}
                      onClick={() => setSelectedTreeNode(orphan)}
                      data-testid={`orphan-${orphan.path}`}
                    >
                      <strong>{orphan.layer}</strong>
                      <span>{orphan.path.split('/').pop()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          
          <section className="docs-right" data-testid="docs-navigator__tree-detail">
            <h3>詳細</h3>
            {renderDetailPanel(selectedTreeNode, {
              emptyMessage: 'ノードを選択してください',
              testId: 'docs-navigator__tree-detail-content',
            })}
          </section>
        </div>
      )}
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
                ? 'FEAT-IDから機能概要と関連ドキュメントを検索できます'
                : '依存関係ツリーとオーファン一覧を閲覧できます'}
          </span>
        </div>
      </div>
      <div className="docs-qg-actions" data-testid="docs-navigator__quality-gates-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDocumentDiagnosis}
          data-testid="docs-navigator__diagnosis-button"
        >
          🔍 全ドキュメント診断
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDocumentInventory}
          data-testid="docs-navigator__inventory-button"
        >
          📦 ドキュメント棚卸し
        </button>
        {qualityGateStatus && (
          <span className="docs-qg-status" data-testid="docs-navigator__quality-gates-status">
            {qualityGateStatus}
          </span>
        )}
      </div>
      {loading && (
        <p className="text-muted" data-testid="docs-navigator__loading">
          コンテキストを読み込み中...
        </p>
      )}
      {!loading && mode === 'docs' && renderDocsMode()}
      {!loading && mode === 'feats' && renderFeatsMode()}
      {!loading && mode === 'tree' && renderTreeMode()}
      
      {/* DocumentViewer Modal */}
      <DocumentViewer
        path={viewerPath}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
      
      {/* DiagnosisModal */}
      <DiagnosisModal
        isOpen={diagnosisModalOpen}
        onClose={() => setDiagnosisModalOpen(false)}
      />
    </section>
  );
}
