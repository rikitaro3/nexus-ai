import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  HelpCircle,
  Info,
  Loader2,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';

type IconRegistry = Record<string, LucideIcon>;

export const iconRegistry = {
  plus: Plus,
  search: Search,
  check: Check,
  close: X,
  info: Info,
  alert: AlertCircle,
  help: HelpCircle,
  arrowRight: ArrowRight,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  externalLink: ExternalLink,
  download: Download,
  settings: Settings,
  loader: Loader2,
} satisfies IconRegistry;

export type IconName = keyof typeof iconRegistry;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  /**
   * アイコン名。`iconRegistry`に登録されているキーを使用します。
   */
  name: IconName;
  /**
   * ローディング時など、スピンアニメーションを有効にします。
   */
  spin?: boolean;
}

/**
 * アプリ全体で利用するアイコンを一元管理するコンポーネント。
 * StorybookやDocsでは`iconRegistry`を参照して利用できるようにしています。
 */
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, className, spin = false, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const LucideIconComponent = iconRegistry[name] ?? iconRegistry.help;

  return (
    <LucideIconComponent
      ref={ref}
      className={spin ? `${className ?? ''} ui-icon--spin`.trim() : className}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      {...rest}
    />
  );
});

export type { LucideProps as IconBaseProps } from 'lucide-react';
