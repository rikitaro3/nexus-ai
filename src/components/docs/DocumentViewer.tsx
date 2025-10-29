'use client';

import matter from 'gray-matter';
import { useEffect, useMemo, useState } from 'react';

interface DocumentViewerProps {
  path: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface DocumentMetadata {
  path: string;
  title: string;
  layer: string;
  upstream: string[];
  downstream: string[];
}

type RawFrontmatter = Record<string, unknown>;

interface Message {
  text: string;
  type: 'success' | 'error';
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// 配列を正規化する関数
function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v !== 'N/A');
  if (typeof value === 'string') {
    if (value === 'N/A' || value.trim() === '') return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// バリデーション関数
function validateDocument(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // YAMLフロントマターのパース
    const { data, content: body } = matter<RawFrontmatter>(content);

    const title = typeof data.title === 'string' ? data.title : null;
    const layer = typeof data.layer === 'string' ? data.layer : null;

    // 必須フィールド
    if (!title) errors.push('フロントマターにtitleが必要です');
    if (!layer) errors.push('フロントマターにlayerが必要です');

    // レイヤーの値チェック
    const validLayers = ['STRATEGY', 'PRD', 'UX', 'API', 'DATA', 'ARCH', 'DEVELOPMENT', 'QA'];
    if (layer && !validLayers.includes(layer)) {
      errors.push(`無効なレイヤー: ${layer}`);
    }

    // Breadcrumbsチェック
    if (!body.includes('> Breadcrumbs')) {
      warnings.push('Breadcrumbsセクションがありません');
    }

    // upstream/downstream チェック
    if (data.upstream !== undefined && !Array.isArray(data.upstream) && typeof data.upstream !== 'string') {
      warnings.push('upstreamは配列または文字列である必要があります');
    }

    if (data.downstream !== undefined && !Array.isArray(data.downstream) && typeof data.downstream !== 'string') {
      warnings.push('downstreamは配列または文字列である必要があります');
    }

  } catch {
    errors.push('YAMLフロントマターの構文エラー');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function createMetadata(data: RawFrontmatter, path: string): DocumentMetadata {
  const title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title : path;
  const layer = typeof data.layer === 'string' && data.layer.trim() !== '' ? data.layer : 'UNKNOWN';

  return {
    path,
    title,
    layer,
    upstream: normalizeArray(data.upstream),
    downstream: normalizeArray(data.downstream),
  };
}

// プロンプト生成関数
function generatePrompt(metadata: DocumentMetadata): string {
  const header = '以下のドキュメントを修正してください。';
  
  const documentInfo = `
**ドキュメント情報:**
- パス: ${metadata.path}
- タイトル: ${metadata.title}
- レイヤー: ${metadata.layer}
- Upstream: ${metadata.upstream.length > 0 ? metadata.upstream.join(', ') : '(なし)'}
- Downstream: ${metadata.downstream.length > 0 ? metadata.downstream.join(', ') : '(なし)'}
`;
  
  const modificationSection = `
**修正内容:**
[ここに具体的な修正指示を記入してください]
`;
  
  const guidelines = `
**注意事項:**
- YAMLフロントマターのupstream/downstreamを適切に更新してください
- Breadcrumbsセクションも同様に更新してください
- Quality Gates（DOC-01〜DOC-08）を遵守してください
- レイヤー定義（STRATEGY, PRD, UX, API, DATA, ARCH, DEVELOPMENT, QA）に従ってください
`;

  return [header, documentInfo, modificationSection, guidelines].join('\n');
}

export default function DocumentViewer({ path, isOpen, onClose }: DocumentViewerProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const validation = useMemo(() => validateDocument(content), [content]);

  const hasValidationErrors = validation.errors.length > 0;
  const validationWarnings = validation.warnings ?? [];
  const hasValidationWarnings = validationWarnings.length > 0;
  const validationStatus = hasValidationErrors ? 'error' : hasValidationWarnings ? 'warning' : 'success';

  const isDirty = useMemo(() => {
    return mode === 'edit' && content !== originalContent;
  }, [mode, content, originalContent]);

  // ドキュメント読み込み
  useEffect(() => {
    if (!isOpen || !path) return;

    const targetPath = path;

    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      setMessage(null);
      setMode('view');

      try {
        const response = await fetch(`/api/docs?path=${encodeURIComponent(targetPath)}`);

        if (!response.ok) {
          throw new Error(`Failed to load document: ${response.status}`);
        }

        const text = await response.text();

        if (cancelled) return;

        setContent(text);
        setOriginalContent(text);

        // メタデータ抽出
        try {
          const { data } = matter<RawFrontmatter>(text);
          setMetadata(createMetadata(data, targetPath));
        } catch (error) {
          console.warn('Failed to parse metadata:', error);
          setMetadata(null);
        }
      } catch (error) {
        console.error('Failed to load document:', error);
        if (!cancelled) {
          setMessage({
            text: error instanceof Error ? error.message : 'ドキュメントを読み込めませんでした',
            type: 'error',
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [isOpen, path]);

  // ESCキーでモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDirty) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, isDirty, onClose]);

  // 未保存警告
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // 保存処理
  async function handleSave() {
    if (!path) return;

    const targetPath = path;

    // バリデーション
    if (!validation.valid) {
      setMessage({
        text: validation.errors.join('\n'),
        type: 'error',
      });
      return;
    }

    // 警告がある場合は確認
    if (hasValidationWarnings) {
      const confirmed = window.confirm(
        `以下の警告があります:\n${validationWarnings.join('\n')}\n\n保存を続けますか？`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Save failed');
      }

      // 成功
      setOriginalContent(content);
      setMode('view');
      setMessage({
        text: '保存しました',
        type: 'success',
      });

      // メタデータ更新
      try {
        const { data } = matter<RawFrontmatter>(content);
        setMetadata(createMetadata(data, targetPath));
      } catch (error) {
        console.warn('Failed to update metadata:', error);
      }

      // 3秒後にメッセージを消す
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save document:', error);
      setMessage({
        text: error instanceof Error ? error.message : '保存に失敗しました',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  // プロンプト生成とコピー
  async function handleCopyPrompt() {
    if (!metadata) return;

    try {
      const prompt = generatePrompt(metadata);
      await navigator.clipboard.writeText(prompt);
      setMessage({
        text: 'プロンプトをコピーしました',
        type: 'success',
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      setMessage({
        text: 'コピーに失敗しました',
        type: 'error',
      });
    }
  }

  // モード切り替え
  function handleEnterEdit() {
    setMode('edit');
    setMessage(null);
  }

  function handleCancelEdit() {
    if (isDirty) {
      const confirmed = window.confirm('編集内容を破棄しますか？');
      if (!confirmed) return;
    }
    setContent(originalContent);
    setMode('view');
    setMessage(null);
  }

  // モーダルを閉じる
  function handleClose() {
    if (isDirty) {
      const confirmed = window.confirm('未保存の変更があります。閉じますか？');
      if (!confirmed) return;
    }
    onClose();
  }

  // オーバーレイクリック
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  // Ctrl+S ショートカット
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (mode === 'edit') {
        handleSave();
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="document-modal-overlay"
      onClick={handleOverlayClick}
      data-testid="document-viewer__overlay"
    >
      <div className="document-modal" data-testid="document-viewer__modal">
        {/* ヘッダー */}
        <div className="document-modal__header" data-testid="document-viewer__header">
          <div className="document-modal__title">
            <span className="document-modal__path" data-testid="document-viewer__path">
              {path}
            </span>
            {mode === 'edit' && (
              <span className="document-modal__badge" data-testid="document-viewer__edit-badge">
                編集中
              </span>
            )}
            {isDirty && (
              <span className="document-modal__badge document-modal__badge--warning" data-testid="document-viewer__dirty-badge">
                未保存
              </span>
            )}
          </div>
          <button
            type="button"
            className="document-modal__close"
            onClick={handleClose}
            aria-label="閉じる"
            data-testid="document-viewer__close-button"
          >
            ✕
          </button>
        </div>

        {/* コンテンツ */}
        <div className="document-modal__content" data-testid="document-viewer__content">
          {loading ? (
            <div className="document-modal__loading" data-testid="document-viewer__loading">
              読み込み中...
            </div>
          ) : mode === 'view' ? (
            <pre className="document-modal__pre" data-testid="document-viewer__pre">
              {content}
            </pre>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="document-modal__textarea"
              spellCheck={false}
              autoComplete="off"
              data-testid="document-viewer__textarea"
            />
          )}
        </div>

        {/* フッター */}
        <div className="document-modal__footer" data-testid="document-viewer__footer">
          <div className="document-modal__status-area" data-testid="document-viewer__status-area">
            {!loading && (content.trim().length > 0 || mode === 'edit') && (
              <div className="document-modal__validation" data-testid="document-viewer__validation">
                <div className="document-modal__validation-header">
                  <span className="document-modal__validation-title">チェック結果</span>
                  <span
                    className={`document-modal__validation-status document-modal__validation-status--${validationStatus}`}
                    data-testid={`document-viewer__validation-status-${validationStatus}`}
                  >
                    {hasValidationErrors
                      ? 'エラーがあります'
                      : hasValidationWarnings
                        ? '警告があります'
                        : '問題は見つかりませんでした'}
                  </span>
                </div>

                {hasValidationErrors && (
                  <div className="document-modal__validation-section" data-testid="document-viewer__validation-errors">
                    <div className="document-modal__validation-section-title">エラー</div>
                    <ul className="document-modal__validation-list">
                      {validation.errors.map((error, index) => (
                        <li key={`error-${index}`}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {hasValidationWarnings && (
                  <div className="document-modal__validation-section" data-testid="document-viewer__validation-warnings">
                    <div className="document-modal__validation-section-title">警告</div>
                    <ul className="document-modal__validation-list">
                      {validationWarnings.map((warning, index) => (
                        <li key={`warning-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!hasValidationErrors && !hasValidationWarnings && (
                  <p className="document-modal__validation-empty">テンプレートの基本チェックを通過しました。</p>
                )}
              </div>
            )}

            {/* メッセージ */}
            {message && (
              <div
                className={`document-modal__message document-modal__message--${message.type}`}
                data-testid={`document-viewer__message-${message.type}`}
              >
                {message.text}
              </div>
            )}
          </div>

          {/* アクションボタン */}
          <div className="document-modal__actions" data-testid="document-viewer__actions">
            {mode === 'view' ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleEnterEdit}
                  disabled={loading}
                  data-testid="document-viewer__edit-button"
                >
                  編集
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCopyPrompt}
                  disabled={loading || !metadata}
                  data-testid="document-viewer__copy-prompt-button"
                >
                  プロンプト生成
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClose}
                  data-testid="document-viewer__cancel-button"
                >
                  閉じる
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  data-testid="document-viewer__save-button"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  data-testid="document-viewer__cancel-edit-button"
                >
                  キャンセル
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

