'use client';

import { useEffect, useMemo, useState } from 'react';
import DocsNavigator from '@/components/docs/DocsNavigator';
import TasksWorkspace from '@/components/tasks/TasksWorkspace';
import SettingsPanel from '@/components/settings/SettingsPanel';
import ConsoleDownloadButton from '@/components/ConsoleDownloadButton';
import '@/lib/ai/providers/cursor';

const TAB_ORDER = ['docs', 'tasks', 'settings'] as const;

type TabKey = (typeof TAB_ORDER)[number];

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
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('dark', darkMode);
    persistTheme(darkMode);
  }, [darkMode]);

  const tabLabels = useMemo(
    () => ({ docs: 'Docs', tasks: 'Tasks', settings: 'Settings' } satisfies Record<TabKey, string>),
    [],
  );

  return (
    <div className="container" data-testid="app-shell__container">
      <header className="app-header" data-testid="app-shell__header">
        <div className="app-header__main">
          <div className="app-brand" data-testid="app-shell__brand">
            <h1 data-testid="app-shell__title">Nexus</h1>
            <p className="app-subtitle" data-testid="app-shell__subtitle">
              Docs / Tasks workspace
            </p>
          </div>
          <div className="app-header__actions">
            <ConsoleDownloadButton />
          </div>
        </div>
      </header>

      <nav className="tabs" data-testid="app-shell__tabs">
        {TAB_ORDER.map(tab => (
          <button
            key={tab}
            type="button"
            className={`tab-btn${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
            data-testid={`app-shell__tab-${tab}`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </nav>

      <main data-testid="app-shell__main">
        <section className={`tab-content${activeTab === 'docs' ? ' active' : ''}`} data-testid="docs-navigator__panel">
          {activeTab === 'docs' && <DocsNavigator />}
        </section>
        <section className={`tab-content${activeTab === 'tasks' ? ' active' : ''}`} data-testid="tasks__panel">
          {activeTab === 'tasks' && <TasksWorkspace onSwitchToDocs={() => setActiveTab('docs')} />}
        </section>
        <section className={`tab-content${activeTab === 'settings' ? ' active' : ''}`} data-testid="settings__panel">
          {activeTab === 'settings' && <SettingsPanel darkMode={darkMode} onToggleTheme={() => setDarkMode(prev => !prev)} />}
        </section>
      </main>
    </div>
  );
}
