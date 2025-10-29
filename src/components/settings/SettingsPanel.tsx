'use client';

import { aiProviderRegistry } from '@/lib/ai/registry';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

const CONTEXT_PATH_KEY = 'nexus.settings.contextPath';
const AI_PROVIDER_KEY = 'nexus.settings.aiProvider';

type SettingsPanelProps = {
  darkMode: boolean;
  onToggleTheme: () => void;
};

function readSetting(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch (error) {
    console.warn(`[SettingsPanel] Failed to read ${key}`, error);
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[SettingsPanel] Failed to persist ${key}`, error);
  }
}

export default function SettingsPanel({ darkMode, onToggleTheme }: SettingsPanelProps) {
  const [contextPath, setContextPath] = useState('');
  const [aiProviderId, setAiProviderId] = useState('');
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setContextPath(readSetting(CONTEXT_PATH_KEY));
    const storedProvider = readSetting(AI_PROVIDER_KEY);
    setAiProviderId(storedProvider);
    if (storedProvider) {
      aiProviderRegistry.setActiveProvider(storedProvider, { silent: true });
    }
    aiProviderRegistry.ensureActiveProvider({ silent: true });
  }, []);

  useEffect(() => {
    const unsubscribe = aiProviderRegistry.subscribe(provider => {
      setAiProviderId(provider?.id ?? '');
    });
    return unsubscribe;
  }, []);

  const providers = useMemo(() => aiProviderRegistry.listProviders(), []);

  const handleSaveContextPath = (value: string) => {
    writeSetting(CONTEXT_PATH_KEY, value);
    setStatus('Context Pathを保存しました');
  };

  const handleProviderChange = (value: string) => {
    setAiProviderId(value);
    writeSetting(AI_PROVIDER_KEY, value);
    aiProviderRegistry.setActiveProvider(value, { silent: true });
    aiProviderRegistry.ensureActiveProvider({ silent: true });
    setStatus(`AI Providerを${value || '未設定'}に変更しました`);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setContextPath(file.name);
      setStatus(`ファイル "${file.name}" を選択しました`);
    }
  };

  const handleSelectFileClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <section className="card" data-testid="settings__section">
      <h2 data-testid="settings__heading">⚙️ Settings</h2>

      <div className="settings-section" data-testid="settings__ai-provider-section">
        <h3 data-testid="settings__ai-provider-heading">AI Provider</h3>
        <div className="form-group" data-testid="settings__ai-provider-group">
          <label htmlFor="settings-ai-provider" data-testid="settings__ai-provider-label">
            Breakdown Provider
          </label>
          <select
            id="settings-ai-provider"
            value={aiProviderId}
            onChange={event => handleProviderChange(event.target.value)}
            data-testid="settings__ai-provider-select"
          >
            <option value="">未設定</option>
            {providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-muted" data-testid="settings__ai-provider-description">
          利用するAIプロバイダーを選択してください。
        </p>
      </div>

      <hr />

      <div className="settings-section" data-testid="settings__context-section">
        <h3 data-testid="settings__context-heading">Context File</h3>
        <p className="settings-context-path" data-testid="settings__context-path">
          {contextPath || '(未設定)'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mdc,.md"
          onChange={handleFileSelect}
          className="sr-only"
          aria-hidden="true"
        />
        <div className="control-group" data-testid="settings__context-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSelectFileClick}
            data-testid="settings__browse-file-button"
          >
            ファイルを選択
          </button>
          <input
            type="text"
            value={contextPath}
            onChange={event => setContextPath(event.target.value)}
            placeholder="context.mdc"
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleSaveContextPath(contextPath)}
            data-testid="settings__select-context-button"
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setContextPath('');
              handleSaveContextPath('');
            }}
            data-testid="settings__clear-context-button"
          >
            Clear
          </button>
        </div>
      </div>

      <hr />

      <div className="settings-section" data-testid="settings__theme-section">
        <h3 data-testid="settings__theme-heading">テーマ</h3>
        <div className="control-group" data-testid="settings__theme-actions">
          <button type="button" className="btn btn-secondary" onClick={onToggleTheme} data-testid="settings__toggle-theme-button">
            {darkMode ? '🌞 ライトモードに切り替え' : '🌙 ダークモードに切り替え'}
          </button>
        </div>
      </div>

      {status && (
        <p className="text-muted settings-status" data-testid="settings__status">
          {status}
        </p>
      )}
    </section>
  );
}
