export type NavigationLink = {
  label: string;
  href: string;
  external?: boolean;
};

export const mainNavigation: NavigationLink[] = [
  { label: 'ドキュメント', href: '#docs' },
  { label: 'タスク', href: '#tasks' },
  { label: 'プロンプト辞書', href: '#prompts' },
  { label: '設定', href: '#settings' },
];

export const footerNavigation: NavigationLink[] = [
  { label: 'GitHub', href: 'https://github.com/', external: true },
  { label: 'サポート', href: 'mailto:support@example.com' },
];
