'use client';

import type { ReactNode } from 'react';

type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface ToastProps {
  tone: ToastTone;
  children: ReactNode;
  className?: string;
  dataTestId?: string;
}

const toneClassMap: Record<ToastTone, string | undefined> = {
  info: 'document-modal__message--info',
  success: 'document-modal__message--success',
  warning: 'document-modal__message--warning',
  error: 'document-modal__message--error',
};

function mergeClassNames(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export default function Toast({ tone, children, className, dataTestId }: ToastProps) {
  return (
    <div
      className={mergeClassNames('document-modal__message', toneClassMap[tone], className)}
      role="status"
      data-testid={dataTestId}
    >
      {children}
    </div>
  );
}
