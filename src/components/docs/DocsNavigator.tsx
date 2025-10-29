'use client';

import matter from 'gray-matter';
import * as jsyaml from 'js-yaml';
import { useEffect, useMemo, useState } from 'react';
import DocumentViewer from './DocumentViewer';

interface ContextEntry {
  category: string;
  path: string;
  description: string;
}

interface DocumentMetadata {
  path: string;
  title: string;
  layer: string;
  upstream: string[];
  downstream: string[];
}

interface TreeNode extends DocumentMetadata {
  children: TreeNode[];
  expanded: boolean;
  isOrphan: boolean;
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

export function parseContextEntries(raw: string): ContextEntry[] {
  // Try YAML format first
  try {
    const yamlData = jsyaml.load(raw) as { contextMap?: Array<{ category: string; entries?: Array<{ path: string; description: string }> }> };
    if (yamlData?.contextMap) {
      console.log('[DocsNavigator] YAML format detected');
      const entries: ContextEntry[] = [];
      for (const cat of yamlData.contextMap) {
        for (const entry of cat.entries || []) {
          entries.push({
            category: cat.category,
            path: entry.path,
            description: entry.description,
          });
        }
      }
      console.log('[DocsNavigator] Parsed YAML entries:', entries.length);
      return entries;
    }
  } catch {
    console.log('[DocsNavigator] Not YAML format, trying Markdown');
  }

  // Fallback to Markdown format
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
  console.log('[DocsNavigator] Parsed Markdown entries:', entries.length);
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
    const { data } = matter(text);
    
    // upstream/downstreamを配列に正規化
    const normalizeArray = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v !== 'N/A');
      if (typeof value === 'string') {
        if (value === 'N/A' || value.trim() === '') return [];
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
    };
    
    return {
      path,
      title: (data.title as string) || path,
      layer: (data.layer as string) || 'UNKNOWN',
      upstream: normalizeArray(data.upstream),
      downstream: normalizeArray(data.downstream),
    };
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
  
  // Tree mode states
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [orphans, setOrphans] = useState<DocumentMetadata[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState<TreeNode | DocumentMetadata | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  
  // DocumentViewer states
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

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
          {renderDetailPanel(
            activeEntry ? {
              path: activeEntry.path,
              description: activeEntry.description,
            } : null
          )}
        </section>
      </div>
    </div>
  );

  // 詳細パネルの共通表示コンポーネント
  const renderDetailPanel = (
    data: {
      path: string;
      title?: string;
      description?: string;
      layer?: string;
      upstream?: string[];
      downstream?: string[];
    } | null,
    options: {
      emptyMessage?: string;
      testId?: string;
    } = {}
  ) => {
    const { emptyMessage = 'ドキュメントが選択されていません', testId = 'docs-navigator__detail' } = options;
    
    if (!data) {
      return (
        <p className="empty-state" data-testid="docs-navigator__detail-empty">
          {emptyMessage}
        </p>
      );
    }

    return (
      <div className="docs-detail" data-testid={testId}>
        <p className="docs-detail__path">
          <span className="docs-detail__label">Path:</span>
          <code>{data.path}</code>
        </p>
        
        {data.layer && (
          <p className="docs-detail__layer">
            <span className="docs-detail__label">Layer:</span>
            <strong>{data.layer}</strong>
          </p>
        )}
        
        {data.title && (
          <p className="docs-detail__title">
            <span className="docs-detail__label">Title:</span>
            {data.title}
          </p>
        )}
        
        {data.description && !data.layer && (
          <p className="docs-detail__description">{data.description}</p>
        )}
        
        {(data.upstream || data.downstream) && (
          <div className="docs-detail__links">
            {data.upstream && (
              <div>
                <span className="docs-detail__label">Upstream:</span>
                {data.upstream.length > 0 ? (
                  <ul>
                    {data.upstream.map(upPath => (
                      <li key={upPath}>
                        <a href={`/${upPath}`} target="_blank" rel="noreferrer">
                          {upPath}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">(なし)</span>
                )}
              </div>
            )}
            
            {data.downstream && (
              <div>
                <span className="docs-detail__label">Downstream:</span>
                {data.downstream.length > 0 ? (
                  <ul>
                    {data.downstream.map(downPath => (
                      <li key={downPath}>
                        <a href={`/${downPath}`} target="_blank" rel="noreferrer">
                          {downPath}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">(なし)</span>
                )}
              </div>
            )}
          </div>
        )}
        
        <div className="control-group">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setViewerPath(data.path);
              setViewerOpen(true);
            }}
            data-testid="docs-navigator__open-document-button"
          >
            ドキュメントを開く
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigator.clipboard?.writeText(data.path)}
          >
            パスをコピー
          </button>
        </div>
      </div>
    );
  };

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

  const renderTreeNode = (node: TreeNode, depth = 0): JSX.Element => {
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
      {!loading && mode === 'tree' && renderTreeMode()}
      
      {/* DocumentViewer Modal */}
      <DocumentViewer
        path={viewerPath}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </section>
  );
}
