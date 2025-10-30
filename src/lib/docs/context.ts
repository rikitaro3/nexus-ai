import * as jsyaml from 'js-yaml';

export interface ContextEntry {
  category: string;
  path: string;
  description: string;
}

function extractSection(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) return '';

  const tail = source.slice(start + marker.length);
  const nextHeading = tail.indexOf('\n## ');
  if (nextHeading === -1) {
    return tail.trim();
  }

  return tail.slice(0, nextHeading).trim();
}

export function parseContextEntries(raw: string): ContextEntry[] {
  try {
    const yamlData = jsyaml.load(raw) as {
      contextMap?: Array<{ category: string; entries?: Array<{ path: string; description: string }> }>;
    } | undefined;

    if (yamlData?.contextMap) {
      const entries: ContextEntry[] = [];

      for (const category of yamlData.contextMap) {
        if (!category?.category) continue;
        for (const entry of category.entries ?? []) {
          if (!entry?.path || !entry?.description) continue;
          entries.push({
            category: category.category,
            path: entry.path,
            description: entry.description,
          });
        }
      }

      if (entries.length > 0) {
        return entries;
      }
    }
  } catch {
    // YAMLとして解釈できなかった場合はMarkdown解析にフォールバック
  }

  const section = extractSection(raw, '## Context Map');
  if (!section) return [];

  const lines = section.split('\n');
  const entries: ContextEntry[] = [];
  let currentCategory = '';

  for (const line of lines) {
    if (line.startsWith('### ')) {
      currentCategory = line.replace(/^###\s+/, '').trim();
      continue;
    }

    const match = line.match(/^-\s+([^\s].*?)\s+…\s+(.*)$/u);
    if (match && currentCategory) {
      entries.push({
        category: currentCategory,
        path: match[1].trim(),
        description: match[2].trim(),
      });
    }
  }

  return entries;
}
