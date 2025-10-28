'use client';

import { useEffect, useMemo, useState } from 'react';

import DocsNavigator from '@/components/docs/DocsNavigator';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';
import SettingsPanel from '@/components/settings/SettingsPanel';
import '@/lib/ai/providers/cursor';

const TAB_ORDER = ['docs', 'tasks', 'settings'] as const;

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

  const tabLabels = useMemo(
    () => ({ docs: 'Docs', tasks: 'Tasks', settings: 'Settings' } satisfies Record<TabKey, string>),
    [],
  );

  const handleSelectTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const hash = `#${tab}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash);
      }
    }
  };

  return (
    <div className="app-shell" data-testid="app-shell__container">
      <nav
        className="tabs app-shell__tabs"
        data-testid="app-shell__tabs"
        role="tablist"
        aria-label="ワークスペースのビュー"
      >
        {TAB_ORDER.map(tab => (
          <button
            key={tab}
            type="button"
            className={`tab-btn${activeTab === tab ? ' active' : ''}`}
            onClick={() => handleSelectTab(tab)}
            data-testid={`app-shell__tab-${tab}`}
            id={`app-shell__tab-${tab}`}
            aria-controls={tab}
            aria-selected={activeTab === tab}
            role="tab"
          >
            {tabLabels[tab]}
          </button>
        ))}
      </nav>

      <div className="app-shell__content" data-testid="app-shell__main">
        <section
          id="docs"
          className={`tab-content${activeTab === 'docs' ? ' active' : ''}`}
          data-testid="docs-navigator__panel"
          role="tabpanel"
          aria-labelledby="app-shell__tab-docs"
        >
          {activeTab === 'docs' && <DocsNavigator />}
        </section>
        <section
          id="tasks"
          className={`tab-content${activeTab === 'tasks' ? ' active' : ''}`}
          data-testid="tasks__panel"
          role="tabpanel"
          aria-labelledby="app-shell__tab-tasks"
        >
          {activeTab === 'tasks' && <TasksWorkspace onSwitchToDocs={() => handleSelectTab('docs')} />}
        </section>
        <section
          id="settings"
          className={`tab-content${activeTab === 'settings' ? ' active' : ''}`}
          data-testid="settings__panel"
          role="tabpanel"
          aria-labelledby="app-shell__tab-settings"
        >
          {activeTab === 'settings' && (
            <SettingsPanel darkMode={darkMode} onToggleTheme={() => setDarkMode(prev => !prev)} />
          )}
        </section>
      </div>
    </div>
  );
}
