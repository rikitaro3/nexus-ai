import { promises as fs } from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

export interface DocumentTemplateSummary {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  layer?: string;
  suggestedOutputPath?: string;
  defaults?: Record<string, unknown>;
}

export interface GenerateDocumentOptions {
  projectRoot: string;
  templateIdOrPath: string;
  absoluteOutputPath: string;
  title?: string;
  layer?: string;
  upstream?: string[];
  downstream?: string[];
  tags?: string[];
  extra?: Record<string, string>;
  force?: boolean;
}

interface LoadedTemplate {
  id: string;
  name: string;
  description?: string;
  layer?: string;
  defaults?: Record<string, unknown>;
  content?: string;
  templatePath: string;
}

interface FrontMatterShape {
  [key: string]: unknown;
  title: string;
  template?: string;
  layer?: string;
  upstream?: string[];
  downstream?: string[];
  tags?: string[];
}

export async function listDocumentTemplates(projectRoot: string): Promise<DocumentTemplateSummary[]> {
  const templatesDir = path.join(projectRoot, 'docs', 'templates');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(templatesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const templates: DocumentTemplateSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const filePath = path.join(templatesDir, entry);
    try {
      const loaded = await loadTemplate(projectRoot, filePath);
      const id = loaded.id || path.basename(entry, path.extname(entry));
      const name = loaded.name || id;
      const layer = resolveLayer(loaded);
      const suggestedOutputPath = buildSuggestedOutputPath(id, layer);
      templates.push({
        id,
        name,
        description: loaded.description,
        filePath,
        layer,
        suggestedOutputPath,
        defaults: sanitizeDefaults(loaded.defaults)
      });
    } catch (error) {
      // Skip templates that fail to load but continue processing others
      console.warn('[doc-templates] Failed to load template', filePath, error);
    }
  }

  templates.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return templates;
}

export async function generateDocumentFromTemplate(options: GenerateDocumentOptions): Promise<{ outputPath: string; frontMatter: FrontMatterShape; templateId: string; body: string; documentText: string; }> {
  const {
    projectRoot,
    templateIdOrPath,
    absoluteOutputPath,
    title,
    layer,
    upstream = [],
    downstream = [],
    tags = [],
    extra = {},
    force = false
  } = options;

  const loaded = await resolveTemplate(projectRoot, templateIdOrPath);
  const frontMatter = buildFrontMatter(loaded, {
    title,
    layer,
    upstream,
    downstream,
    tags,
    extra
  });
  const body = renderBody(loaded, frontMatter);
  const documentText = stringifyDocument(frontMatter, body);

  if (!force) {
    try {
      await fs.access(absoluteOutputPath);
      throw new Error(`出力先ファイルが既に存在します: ${absoluteOutputPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await fs.writeFile(absoluteOutputPath, documentText, 'utf8');

  return {
    outputPath: absoluteOutputPath,
    frontMatter,
    templateId: loaded.id,
    body,
    documentText
  };
}

async function resolveTemplate(projectRoot: string, templateIdOrPath: string): Promise<LoadedTemplate> {
  const explicitPath = path.isAbsolute(templateIdOrPath)
    ? templateIdOrPath
    : path.join(projectRoot, templateIdOrPath);
  const candidates: string[] = [];

  if (templateIdOrPath.endsWith('.yaml') || templateIdOrPath.endsWith('.yml')) {
    candidates.push(explicitPath);
  } else {
    candidates.push(path.join(projectRoot, 'docs', 'templates', `${templateIdOrPath}.yaml`));
    candidates.push(path.join(projectRoot, 'docs', 'templates', `${templateIdOrPath}.yml`));
  }

  for (const candidate of candidates) {
    try {
      const loaded = await loadTemplate(projectRoot, candidate);
      if (!loaded.id) {
        loaded.id = templateIdOrPath;
      }
      return loaded;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`テンプレートが見つかりません: ${templateIdOrPath}`);
}

async function loadTemplate(projectRoot: string, templatePath: string): Promise<LoadedTemplate> {
  const resolved = path.isAbsolute(templatePath)
    ? templatePath
    : path.join(projectRoot, templatePath);
  const content = await fs.readFile(resolved, 'utf8');
  const data = (yaml.load(content) as Record<string, unknown>) || {};
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : path.basename(resolved, path.extname(resolved));
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id;
  const description = typeof data.description === 'string' ? data.description : undefined;
  const defaults = typeof data.defaults === 'object' && data.defaults !== null ? data.defaults as Record<string, unknown> : undefined;
  const layer = typeof data.layer === 'string' && data.layer.trim() ? data.layer.trim() : undefined;
  const templateContent = typeof data.content === 'string' ? data.content : '';

  return {
    id,
    name,
    description,
    defaults,
    layer,
    content: templateContent,
    templatePath: resolved
  };
}

function buildFrontMatter(template: LoadedTemplate, overrides: {
  title?: string;
  layer?: string;
  upstream?: string[];
  downstream?: string[];
  tags?: string[];
  extra?: Record<string, string>;
}): FrontMatterShape {
  const defaults = typeof template.defaults === 'object' && template.defaults !== null
    ? { ...template.defaults }
    : {};
  const extra = overrides.extra || {};
  const frontMatter: FrontMatterShape = { ...defaults, ...extra } as FrontMatterShape;

  const resolvedLayer = overrides.layer || (typeof template.layer === 'string' ? template.layer : (defaults.layer as string | undefined));
  if (resolvedLayer) {
    frontMatter.layer = resolvedLayer;
  }

  frontMatter.upstream = mergeLists(asStringArray(defaults.upstream), overrides.upstream || []);
  frontMatter.downstream = mergeLists(asStringArray(defaults.downstream), overrides.downstream || []);
  frontMatter.tags = mergeLists(asStringArray(defaults.tags), overrides.tags || []);

  const candidateTitle = overrides.title || (defaults.title as string | undefined) || template.name || template.id || '新規ドキュメント';
  frontMatter.title = candidateTitle;
  frontMatter.template = template.id;

  return frontMatter;
}

function renderBody(template: LoadedTemplate, frontMatter: FrontMatterShape): string {
  const raw = typeof template.content === 'string' ? template.content : '';
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key === 'upstream' || key === 'downstream' || key === 'tags') {
      const list = frontMatter[key];
      return Array.isArray(list) ? list.join(', ') : '';
    }
    const value = frontMatter[key];
    return typeof value === 'string' ? value : '';
  });
}

function stringifyDocument(frontMatter: FrontMatterShape, body: string): string {
  const dumped = yaml.dump(frontMatter, { lineWidth: 100 }).trimEnd();
  const sanitizedBody = body.replace(/\s+$/u, '');
  return `---\n${dumped}\n---\n\n${sanitizedBody}\n`;
}

function mergeLists(base: unknown, additions: string[]): string[] {
  const set = new Set<string>();
  if (Array.isArray(base)) {
    for (const item of base) {
      if (typeof item === 'string' && item.trim()) {
        set.add(item.trim());
      }
    }
  }
  for (const item of additions) {
    if (typeof item === 'string' && item.trim()) {
      set.add(item.trim());
    }
  }
  return Array.from(set);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(entry => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

function resolveLayer(template: LoadedTemplate): string | undefined {
  if (template.layer) return template.layer;
  if (template.defaults && typeof template.defaults.layer === 'string') {
    const raw = template.defaults.layer.trim();
    return raw || undefined;
  }
  return undefined;
}

function buildSuggestedOutputPath(templateId: string, layer?: string): string {
  const normalizedLayer = layer ? layer.toUpperCase() : '';
  const safeId = templateId.replace(/[^a-zA-Z0-9\-_.一-龠ぁ-んァ-ヶ]/g, '-');
  const baseDir = normalizedLayer ? `docs/${normalizedLayer}` : 'docs';
  return `${baseDir}/${safeId}.mdc`;
}

function sanitizeDefaults(defaults?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!defaults) return undefined;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (Array.isArray(value)) {
      clone[key] = value.map(item => (typeof item === 'string' ? item.trim() : item));
    } else {
      clone[key] = value;
    }
  }
  return clone;
}
