import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

type IconPosition = 'left' | 'right';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * ボタンのバリアント。色や背景が変わります。
   */
  variant?: ButtonVariant;
  /**
   * ボタンのサイズ。余白やフォントサイズが変わります。
   */
  size?: ButtonSize;
  /**
   * アイコンを表示する場合に使用します。
   */
  icon?: IconName;
  /**
   * アイコンの表示位置。`left`（デフォルト）と`right`を指定できます。
   */
  iconPosition?: IconPosition;
  /**
   * ローディング状態にし、スピナーを表示します。
   */
  loading?: boolean;
  /**
   * アクセシビリティ用に、テキストの代わりにアイコンだけを表示したい場合に使用します。
   */
  srLabel?: string;
  /**
   * Storybookなどでテキスト以外のコンテンツを表示したい場合に利用できます。
   */
  children?: ReactNode;
}

const variantClassName: Record<ButtonVariant, string> = {
  primary: 'ui-button--primary',
  secondary: 'ui-button--secondary',
  ghost: 'ui-button--ghost',
  outline: 'ui-button--outline',
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: 'ui-button--sm',
  md: 'ui-button--md',
  lg: 'ui-button--lg',
};

/**
 * 再利用可能なボタンコンポーネント。StorybookやDocsのサンプルに使用できます。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconPosition = 'left',
    loading = false,
    srLabel,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const isIconOnly = !children && !!srLabel;
  const classes = [
    'ui-button',
    variantClassName[variant],
    sizeClassName[size],
    loading ? 'ui-button--loading' : undefined,
    isIconOnly ? 'ui-button--icon-only' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconElement = icon ? (
    <Icon name={icon} className="ui-button__icon" aria-hidden="true" />
  ) : null;

  return (
    <button
      ref={ref}
      className={classes}
      disabled={loading || disabled}
      aria-label={isIconOnly ? srLabel : undefined}
      {...rest}
    >
      {loading ? (
        <Icon
          name="loader"
          spin
          className="ui-button__spinner"
          aria-hidden="true"
        />
      ) : (
        <>
          {iconElement && iconPosition === 'left' ? iconElement : null}
          {children}
          {iconElement && iconPosition === 'right' ? iconElement : null}
        </>
      )}
      {isIconOnly && <span className="sr-only">{srLabel}</span>}
    </button>
  );
});

export default Button;
