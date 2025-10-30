'use client';

import type { MouseEvent, ReactNode } from 'react';

interface ModalShellProps {
  isOpen: boolean;
  onRequestClose?: () => void;
  onOverlayClick?: (event: MouseEvent<HTMLDivElement>) => void;
  overlayClassName?: string;
  contentClassName?: string;
  overlayTestId?: string;
  contentTestId?: string;
  children: ReactNode;
  contentRole?: React.AriaRole;
  contentAriaLabelledby?: string;
  contentAriaDescribedby?: string;
}

export default function ModalShell({
  isOpen,
  onRequestClose,
  onOverlayClick,
  overlayClassName,
  contentClassName,
  overlayTestId,
  contentTestId,
  children,
  contentRole = 'dialog',
  contentAriaLabelledby,
  contentAriaDescribedby,
}: ModalShellProps) {
  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    onOverlayClick?.(event);

    if (!event.defaultPrevented) {
      onRequestClose?.();
    }
  };

  return (
    <div
      className={overlayClassName}
      onClick={handleOverlayClick}
      data-testid={overlayTestId}
      role="presentation"
    >
      <div
        className={contentClassName}
        data-testid={contentTestId}
        role={contentRole}
        aria-modal="true"
        aria-labelledby={contentAriaLabelledby}
        aria-describedby={contentAriaDescribedby}
      >
        {children}
      </div>
    </div>
  );
}
