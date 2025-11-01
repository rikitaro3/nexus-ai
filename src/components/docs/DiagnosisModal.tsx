'use client';

import { useEffect, useState } from 'react';

import ModalShell from '@/components/common/ModalShell';

interface DiagnosisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PromptItem {
  id: string;
  title: string;
  description: string;
  body: string;
}

export default function DiagnosisModal({ isOpen, onClose }: DiagnosisModalProps) {
  const [selectedPromptId, setSelectedPromptId] = useState<string>('PRM-DOC-10-CHK-001');
  const [promptBody, setPromptBody] = useState<string>('');
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');

  // 診断プロンプト一覧（手動定義）
  const diagnosisPrompts: Omit<PromptItem, 'body'>[] = [
    {
      id: 'PRM-DOC-10-CHK-001',
      title: '全ドキュメントBreadcrumbs診断',
      description: 'すべてのドキュメントのBreadcrumbsをチェック',
    },
    {
      id: 'PRM-DOC-11-CHK-001',
      title: 'ドキュメント棚卸し',
      description: '冗長・重複・陳腐化したドキュメントを洗い出し',
    },
  ];

  // プロンプトデータを読み込む
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function loadPrompts() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/prompts');
        if (!res.ok) {
          throw new Error(`Failed to fetch prompts (${res.status})`);
        }

        const data = await res.json();
        if (cancelled) return;

        const loaded: PromptItem[] = [];
        for (const category of data.categories || []) {
          for (const item of category.items || []) {
            const promptInfo = diagnosisPrompts.find(p => p.id === item.id);
            if (promptInfo) {
              loaded.push({
                ...promptInfo,
                body: item.body,
              });
            }
          }
        }

        if (!cancelled) {
          setPrompts(loaded);
          if (loaded.length > 0) {
            setSelectedPromptId(loaded[0].id);
            setPromptBody(loaded[0].body);
          }
        }
      } catch (err) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 選択されたプロンプトが変更されたときに本文を更新
  useEffect(() => {
    const selected = prompts.find(p => p.id === selectedPromptId);
    if (selected) {
      setPromptBody(selected.body);
    }
  }, [selectedPromptId, prompts]);

  const handleCopy = async () => {
    if (!promptBody) return;

    try {
      await navigator.clipboard.writeText(promptBody);
      setCopyStatus('コピーしました');
      setTimeout(() => setCopyStatus(''), 3000);
    } catch (error) {
      console.error('[DiagnosisModal] Failed to copy', error);
      setCopyStatus('コピーに失敗しました');
      setTimeout(() => setCopyStatus(''), 3000);
    }
  };

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId);

  return (
    <ModalShell
      isOpen={isOpen}
      onRequestClose={onClose}
      overlayClassName="document-modal-overlay"
      contentClassName="document-modal"
      overlayTestId="diagnosis-modal__overlay"
      contentTestId="diagnosis-modal__modal"
    >
      {/* ヘッダー */}
      <div className="document-modal__header" data-testid="diagnosis-modal__header">
        <div className="document-modal__title">
          <span className="document-modal__path" data-testid="diagnosis-modal__title">
            品質ゲート診断プロンプト
          </span>
        </div>
        <button
          type="button"
          className="document-modal__close"
          onClick={onClose}
          aria-label="閉じる"
          data-testid="diagnosis-modal__close-button"
        >
          ✕
        </button>
      </div>

      {/* コンテンツ */}
      <div className="document-modal__content" data-testid="diagnosis-modal__content">
        {loading ? (
          <div className="document-modal__loading" data-testid="diagnosis-modal__loading">
            プロンプトを読み込み中...
          </div>
        ) : error ? (
          <div className="document-modal__loading" data-testid="diagnosis-modal__error">
            エラー: {error}
          </div>
        ) : (
          <div className="diagnosis-modal__main">
            {/* プロンプト選択 */}
            <div className="diagnosis-modal__selector">
              <h3 className="diagnosis-modal__selector-title">診断プロンプトを選択</h3>
              <div className="diagnosis-modal__prompts-list">
                {diagnosisPrompts.map(prompt => (
                  <div
                    key={prompt.id}
                    className={`diagnosis-modal__prompt-item${
                      selectedPromptId === prompt.id ? ' active' : ''
                    }`}
                    onClick={() => setSelectedPromptId(prompt.id)}
                    data-testid={`diagnosis-modal__prompt-${prompt.id}`}
                  >
                    <h4 className="diagnosis-modal__prompt-title">{prompt.title}</h4>
                    <p className="diagnosis-modal__prompt-description">{prompt.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* プロンプトプレビュー */}
            <div className="diagnosis-modal__preview">
              <div className="document-modal__validation">
                <div className="document-modal__validation-header">
                  <span className="document-modal__validation-title">
                    {selectedPrompt?.title || 'プロンプトを選択してください'}
                  </span>
                  {copyStatus && (
                    <span
                      className="diagnosis-modal__copy-status"
                      data-testid="diagnosis-modal__copy-status"
                    >
                      {copyStatus}
                    </span>
                  )}
                </div>
                {promptBody && (
                  <pre className="diagnosis-modal__pre" data-testid="diagnosis-modal__preview">
                    {promptBody}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="document-modal__footer" data-testid="diagnosis-modal__footer">
        <div className="document-modal__footer-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCopy}
            disabled={!promptBody || loading}
            data-testid="diagnosis-modal__copy-button"
          >
            クリップボードにコピー
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            data-testid="diagnosis-modal__close-footer-button"
          >
            閉じる
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

