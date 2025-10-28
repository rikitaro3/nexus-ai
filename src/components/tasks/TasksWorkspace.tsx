'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { applyTaskDefaults, buildBreakdownPrompt, parsePasted, Task } from '@/lib/tasks';

const STORAGE_KEY = 'nexus.tasks.store';
const CATEGORY_KEY = 'nexus.tasks.category';
const FILTER_KEY = 'nexus.tasks.filter';

const PRIORITY_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'] as const;
const STATUS_OPTIONS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
const LINK_KEYS = ['PRD', 'UX', 'API', 'DATA', 'QA'] as const;

type TasksWorkspaceProps = {
  onSwitchToDocs?: () => void;
};

function readJsonFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[TasksWorkspace] Failed to read ${key}`, error);
    return fallback;
  }
}

function writeJsonToStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[TasksWorkspace] Failed to persist ${key}`, error);
  }
}

export default function TasksWorkspace({ onSwitchToDocs }: TasksWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [bulkText, setBulkText] = useState<string>('');
  const [addCategory, setAddCategory] = useState<string>('Uncategorized');
  const [addTitle, setAddTitle] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    const storedTasks = readJsonFromStorage<Task[]>(STORAGE_KEY, []);
    if (storedTasks.length) {
      const hydrated = storedTasks.map(entry => applyTaskDefaults(entry));
      setTasks(hydrated);
      const storedCategory = readJsonFromStorage<string>(CATEGORY_KEY, hydrated[0].category);
      setCategoryFilter(storedCategory || hydrated[0].category);
      setSelectedTaskId(hydrated[0].id);
    } else {
      const storedCategory = readJsonFromStorage<string>(CATEGORY_KEY, '');
      setCategoryFilter(storedCategory);
    }
    const storedFilter = readJsonFromStorage<string>(FILTER_KEY, '');
    setSearchQuery(storedFilter);
  }, []);

  useEffect(() => {
    writeJsonToStorage(STORAGE_KEY, tasks);
  }, [tasks]);

  useEffect(() => {
    writeJsonToStorage(CATEGORY_KEY, categoryFilter);
  }, [categoryFilter]);

  useEffect(() => {
    writeJsonToStorage(FILTER_KEY, searchQuery);
  }, [searchQuery]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks) {
      if (task.category) set.add(task.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (categoryFilter && task.category !== categoryFilter) return false;
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        task.title.toLowerCase().includes(term) ||
        task.notes.toLowerCase().includes(term) ||
        task.featId.toLowerCase().includes(term)
      );
    });
  }, [tasks, categoryFilter, searchQuery]);

  const selectedTask = useMemo(
    () => tasks.find(task => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const handleBulkImport = () => {
    if (!bulkText.trim()) {
      setStatusMessage('貼り付け欄が空です');
      return;
    }
    const imported = parsePasted(bulkText);
    if (!imported.length) {
      setStatusMessage('取り込み対象がありません');
      return;
    }
    setTasks(prev => [...prev, ...imported]);
    setCategoryFilter(imported[0].category);
    setSelectedTaskId(imported[0].id);
    setBulkText('');
    setStatusMessage(`${imported.length}件のタスクを追加しました`);
  };

  const handleAddTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addTitle.trim()) {
      setStatusMessage('タイトルを入力してください');
      return;
    }
    const [created] = parsePasted(`【${addCategory || 'Uncategorized'}】 ${addTitle.trim()}`);
    setTasks(prev => [...prev, created]);
    setCategoryFilter(created.category);
    setSelectedTaskId(created.id);
    setAddTitle('');
    setStatusMessage('タスクを追加しました');
  };

  const updateTask = (id: string, changes: Partial<Task>) => {
    setTasks(prev =>
      prev.map(task => (task.id === id ? { ...task, ...changes, updatedAt: new Date().toISOString() } : task)),
    );
  };

  const handleTaskFieldChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!selectedTask) return;
    const { name, value } = event.target;
    if (name.startsWith('link:')) {
      const linkKey = name.split(':')[1];
      updateTask(selectedTask.id, {
        links: { ...selectedTask.links, [linkKey]: value },
      });
    } else {
      updateTask(selectedTask.id, { [name]: value } as Partial<Task>);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!selectedTask) return;
    const prompt = buildBreakdownPrompt({
      title: selectedTask.title,
      category: selectedTask.category,
      priority: selectedTask.priority,
      featId: selectedTask.featId,
      links: selectedTask.links,
    });
    updateTask(selectedTask.id, {
      breakdownPrompt: prompt,
      lastBreakdownAt: new Date().toISOString(),
    });
    setStatusMessage('Breakdown Promptを生成しました');
  };

  const handleCopyPrompt = async () => {
    if (!selectedTask?.breakdownPrompt) {
      setStatusMessage('Breakdown Promptが空です');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedTask.breakdownPrompt);
      setStatusMessage('クリップボードにコピーしました');
    } catch (error) {
      console.warn('[TasksWorkspace] Failed to copy prompt', error);
      setStatusMessage('クリップボードへのコピーに失敗しました');
    }
  };

  const handleOpenDocs = () => {
    if (onSwitchToDocs) {
      onSwitchToDocs();
    }
  };

  return (
    <section className="card" data-testid="tasks__section">
      <h2 data-testid="tasks__heading">✅ Tasks</h2>

      <div className="tasks-inputs">
        <form className="tasks-inputs__add" onSubmit={handleAddTask}>
          <div className="form-group">
            <label htmlFor="tasks-add-category">カテゴリ</label>
            <input
              id="tasks-add-category"
              type="text"
              value={addCategory}
              onChange={event => setAddCategory(event.target.value)}
              placeholder="Uncategorized"
            />
          </div>
          <div className="form-group">
            <label htmlFor="tasks-add-title">タイトル</label>
            <input
              id="tasks-add-title"
              type="text"
              value={addTitle}
              onChange={event => setAddTitle(event.target.value)}
              placeholder="Implement API"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            タスクを追加
          </button>
        </form>

        <div className="tasks-inputs__bulk">
          <label htmlFor="tasks-bulk">まとめて取り込み</label>
          <textarea
            id="tasks-bulk"
            value={bulkText}
            onChange={event => setBulkText(event.target.value)}
            placeholder="【Backend】 Implement API"
          />
          <div className="control-group">
            <button type="button" className="btn btn-secondary" onClick={handleBulkImport}>
              貼り付け内容をタスク化
            </button>
          </div>
        </div>
      </div>

      <div className="tasks-layout docs-split">
        <aside className="docs-left" data-testid="tasks__category-column">
          <h3 data-testid="tasks__category-heading">カテゴリ</h3>
          <ul data-testid="tasks__category-list">
            {categories.map(category => (
              <li
                key={category}
                className={category === categoryFilter ? 'active' : ''}
                onClick={() => {
                  setCategoryFilter(category);
                  if (!selectedTask || selectedTask.category !== category) {
                    const first = tasks.find(task => task.category === category);
                    if (first) setSelectedTaskId(first.id);
                  }
                }}
              >
                {category}
              </li>
            ))}
          </ul>
          {categories.length === 0 && (
            <p className="empty-state" data-testid="tasks__category-empty">
              タスクを追加するとカテゴリが表示されます
            </p>
          )}
        </aside>

        <section className="docs-middle" data-testid="tasks__list-column">
          <div className="form-group">
            <label htmlFor="tasks-filter">フィルター</label>
            <input
              id="tasks-filter"
              type="text"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="検索キーワード"
            />
          </div>
          <h3 data-testid="tasks__list-heading">一覧</h3>
          <ul data-testid="tasks__list">
            {filteredTasks.map(task => (
              <li
                key={task.id}
                className={task.id === selectedTaskId ? 'active' : ''}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <strong>{task.title || '(無題)'}</strong>
                <span>{task.category} / {task.priority} / {task.status}</span>
              </li>
            ))}
          </ul>
          {filteredTasks.length === 0 && (
            <p className="empty-state" data-testid="tasks__list-empty">
              タスクがありません。上のフォームから追加してください。
            </p>
          )}
        </section>

        <section className="docs-right" data-testid="tasks__detail-column">
          <h3 data-testid="tasks__detail-heading">詳細</h3>
          {selectedTask ? (
            <div id="task-detail" data-testid="tasks__detail-panel">
              <div className="form-group">
                <label htmlFor="task-title">タイトル</label>
                <input
                  id="task-title"
                  name="title"
                  type="text"
                  value={selectedTask.title}
                  onChange={handleTaskFieldChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="task-category">カテゴリ</label>
                <input
                  id="task-category"
                  name="category"
                  type="text"
                  value={selectedTask.category}
                  onChange={handleTaskFieldChange}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="task-priority">優先度</label>
                  <select
                    id="task-priority"
                    name="priority"
                    value={selectedTask.priority}
                    onChange={handleTaskFieldChange}
                  >
                    {PRIORITY_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="task-status">ステータス</label>
                  <select
                    id="task-status"
                    name="status"
                    value={selectedTask.status}
                    onChange={handleTaskFieldChange}
                  >
                    {STATUS_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="task-feat">FEAT ID</label>
                <input
                  id="task-feat"
                  name="featId"
                  type="text"
                  value={selectedTask.featId}
                  onChange={handleTaskFieldChange}
                />
              </div>
              <div className="form-group">
                <label>関連ドキュメント</label>
                <div className="tasks-links-grid">
                  {LINK_KEYS.map(key => (
                    <div className="form-group" key={key}>
                      <label htmlFor={`task-link-${key}`}>{key}</label>
                      <input
                        id={`task-link-${key}`}
                        name={`link:${key}`}
                        type="text"
                        value={selectedTask.links[key] ?? ''}
                        onChange={handleTaskFieldChange}
                        placeholder={`docs/${key.toLowerCase()}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="task-notes">メモ</label>
                <textarea
                  id="task-notes"
                  name="notes"
                  value={selectedTask.notes}
                  onChange={handleTaskFieldChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="task-breakdown-prompt">Breakdown Prompt</label>
                <textarea
                  id="task-breakdown-prompt"
                  name="breakdownPrompt"
                  value={selectedTask.breakdownPrompt}
                  onChange={handleTaskFieldChange}
                  rows={10}
                />
                <div className="control-group">
                  <button type="button" className="btn btn-secondary" onClick={handleGeneratePrompt}>
                    プロンプト生成
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
                    コピー
                  </button>
                </div>
                {selectedTask.lastBreakdownAt && (
                  <p className="text-muted" id="task-breakdown-stamp">
                    Last: {new Date(selectedTask.lastBreakdownAt).toLocaleString('ja-JP')}
                  </p>
                )}
              </div>
              <div className="control-group">
                <button type="button" className="btn btn-ghost" onClick={handleOpenDocs}>
                  Docsで関連資料を確認
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state" data-testid="tasks__detail-empty">
              タスクを選択すると編集できます
            </div>
          )}
        </section>
      </div>
      {statusMessage && <p className="text-muted tasks-status">{statusMessage}</p>}
    </section>
  );
}
