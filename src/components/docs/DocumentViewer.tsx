'use client';

import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import ModalShell from '@/components/common/ModalShell';
import StatusBadge from '@/components/common/StatusBadge';
import Toast from '@/components/common/Toast';
import { extractDocumentMetadata, type DocumentMetadata } from '@/lib/docs/metadata';
import { validateDocument } from '@/lib/docs/validation';

interface DocumentViewerProps {
  path: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  text: string;
  type: 'success' | 'error';
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
        const parsedMetadata = extractDocumentMetadata(text, targetPath);
        if (!parsedMetadata) {
          console.warn('Failed to parse metadata');
        }
        setMetadata(parsedMetadata);
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
      const parsedMetadata = extractDocumentMetadata(content, targetPath);
      if (!parsedMetadata) {
        console.warn('Failed to update metadata');
      }
      setMetadata(parsedMetadata);

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

  // Ctrl+S ショートカット
  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (mode === 'edit') {
        handleSave();
      }
    }
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onRequestClose={handleClose}
      overlayClassName="document-modal-overlay"
      contentClassName="document-modal"
      overlayTestId="document-viewer__overlay"
      contentTestId="document-viewer__modal"
    >
        {/* ヘッダー */}
        <div className="document-modal__header" data-testid="document-viewer__header">
          <div className="document-modal__title">
            <span className="document-modal__path" data-testid="document-viewer__path">
              {path}
            </span>
            {mode === 'edit' && (
              <StatusBadge dataTestId="document-viewer__edit-badge">編集中</StatusBadge>
            )}
            {isDirty && (
              <StatusBadge tone="warning" dataTestId="document-viewer__dirty-badge">
                未保存
              </StatusBadge>
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
              <Toast tone={message.type} dataTestId={`document-viewer__message-${message.type}`}>
                {message.text}
              </Toast>
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
      </ModalShell>
  );
}

