/**
 * グローバルCSS変数（`src/app/globals.css`）と同期しているデザイントークン。
 * TailwindやStorybookからも参照できるように定義しています。
 */
export const colors = {
  background: '#f7f8fa',
  foreground: '#111827',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  border: '#e5e7eb',
  borderStrong: '#cbd5f5',
  primary: '#2563eb',
  primaryEmphasis: '#1d4ed8',
  primaryMuted: '#eff6ff',
  accent: '#3b82f6',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
  textMuted: '#6b7280',
  textSubtle: '#475569',
  white: '#ffffff',
  black: '#111827',
} as const;

export const spacing = {
  '3xs': '0.125rem',
  '2xs': '0.25rem',
  xs: '0.5rem',
  sm: '0.75rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const;

export const radii = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '20px',
  full: '9999px',
} as const;

export const font = {
  family: `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  lineHeight: 1.5,
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  font,
};

export type Theme = typeof theme;

export type ThemeColor = keyof typeof colors;
export type ThemeSpacing = keyof typeof spacing;
export type ThemeRadius = keyof typeof radii;

export default theme;
