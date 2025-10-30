'use client';

import type { ReactNode } from 'react';

export type StatusBadgeTone = 'default' | 'info' | 'success' | 'warning' | 'error';

interface StatusBadgeProps {
  tone?: StatusBadgeTone;
  children: ReactNode;
  className?: string;
  dataTestId?: string;
}

const toneClassMap: Record<StatusBadgeTone, string | undefined> = {
  default: undefined,
  info: 'document-modal__badge--info',
  success: 'document-modal__badge--success',
  warning: 'document-modal__badge--warning',
  error: 'document-modal__badge--error',
};

function mergeClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export default function StatusBadge({ tone = 'default', children, className, dataTestId }: StatusBadgeProps) {
  return (
    <span
      className={mergeClassNames('document-modal__badge', toneClassMap[tone], className)}
      data-testid={dataTestId}
    >
      {children}
    </span>
  );
}
