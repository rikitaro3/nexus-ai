'use client';

import { useEffect, useState } from 'react';

import DocsNavigator from '@/components/docs/DocsNavigator';
import PromptsViewer from '@/components/prompts/PromptsViewer';
import SettingsPanel from '@/components/settings/SettingsPanel';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';
import '@/lib/ai/providers/cursor';

const TAB_ORDER = ['docs', 'tasks', 'prompts', 'settings'] as const;

type TabKey = (typeof TAB_ORDER)[number];

const TAB_KEYS = new Set<TabKey>(TAB_ORDER);

function readStoredTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem('nexus.theme');
    if (!stored) return false;
    return stored === 'dark';
  } catch (error) {
    console.warn('[AppClient] Failed to read theme from storage', error);
    return false;
  }
}

function persistTheme(isDark: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('nexus.theme', isDark ? 'dark' : 'light');
  } catch (error) {
    console.warn('[AppClient] Failed to persist theme', error);
  }
}

export default function AppClient() {
  const [activeTab, setActiveTab] = useState<TabKey>('docs');
  const [darkMode, setDarkMode] = useState<boolean>(false);

  useEffect(() => {
    setDarkMode(readStoredTheme());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncTabWithHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (TAB_KEYS.has(hash as TabKey)) {
        setActiveTab(hash as TabKey);
      }
    };

    syncTabWithHash();
    window.addEventListener('hashchange', syncTabWithHash);

    return () => {
      window.removeEventListener('hashchange', syncTabWithHash);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('dark', darkMode);
    persistTheme(darkMode);
  }, [darkMode]);

  const handleSwitchToDocs = () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '#docs';
    }
  };

  return (
    <div className="app-shell" data-testid="app-shell__container">
      <div className="app-shell__content" data-testid="app-shell__main">
        <section
          id="docs"
          className={`tab-content${activeTab === 'docs' ? ' active' : ''}`}
          data-testid="docs-navigator__panel"
          role="tabpanel"
          aria-label="ドキュメント"
        >
          {activeTab === 'docs' && <DocsNavigator />}
        </section>
        <section
          id="tasks"
          className={`tab-content${activeTab === 'tasks' ? ' active' : ''}`}
          data-testid="tasks__panel"
          role="tabpanel"
          aria-label="タスク"
        >
          {activeTab === 'tasks' && <TasksWorkspace onSwitchToDocs={handleSwitchToDocs} />}
        </section>
        <section
          id="prompts"
          className={`tab-content${activeTab === 'prompts' ? ' active' : ''}`}
          data-testid="prompts__panel"
          role="tabpanel"
          aria-label="プロンプト辞書"
        >
          {activeTab === 'prompts' && <PromptsViewer />}
        </section>
        <section
          id="settings"
          className={`tab-content${activeTab === 'settings' ? ' active' : ''}`}
          data-testid="settings__panel"
          role="tabpanel"
          aria-label="設定"
        >
          {activeTab === 'settings' && (
            <SettingsPanel darkMode={darkMode} onToggleTheme={() => setDarkMode(prev => !prev)} />
          )}
        </section>
      </div>
    </div>
  );
}
