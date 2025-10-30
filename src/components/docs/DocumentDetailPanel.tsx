'use client';

import type { ReactNode } from 'react';

export interface DetailPanelData {
  path: string;
  title?: string;
  description?: string;
  layer?: string;
  upstream?: string[];
  downstream?: string[];
}

export interface DetailPanelOptions {
  emptyMessage?: string;
  testId?: string;
  footer?: ReactNode;
}

interface DocumentDetailPanelProps extends DetailPanelOptions {
  data: DetailPanelData | null;
  onOpenDocument?: (path: string) => void;
  onCopyPath?: (path: string) => void;
}

const DEFAULT_EMPTY_MESSAGE = 'ドキュメントが選択されていません';

export default function DocumentDetailPanel({
  data,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  testId = 'docs-navigator__detail',
  footer,
  onOpenDocument,
  onCopyPath,
}: DocumentDetailPanelProps) {
  if (!data) {
    return (
      <p className="empty-state" data-testid="docs-navigator__detail-empty">
        {emptyMessage}
      </p>
    );
  }

  const handleOpenDocument = () => {
    onOpenDocument?.(data.path);
  };

  const handleCopyPath = async () => {
    if (onCopyPath) {
      onCopyPath(data.path);
      return;
    }

    try {
      await navigator.clipboard?.writeText(data.path);
    } catch (error) {
      console.error('[DocumentDetailPanel] Failed to copy path:', error);
    }
  };

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

      {data.description && (
        <p className="docs-detail__description">
          <span className="docs-detail__label">Description:</span>
          {data.description}
        </p>
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
          onClick={handleOpenDocument}
          data-testid="docs-navigator__open-document-button"
        >
          ドキュメントを開く
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleCopyPath}>
          パスをコピー
        </button>
        {footer}
      </div>
    </div>
  );
}
