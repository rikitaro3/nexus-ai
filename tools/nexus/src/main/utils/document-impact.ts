import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger.js';

export interface ImpactedDocument {
  path: string;
  absolutePath: string;
  category: string | null;
  status: 'ok' | 'missing' | 'unreadable';
  exists: boolean;
  message?: string;
}

export interface ImpactScanSummary {
  total: number;
  missing: number;
  unreadable: number;
  categories: Record<string, number>;
}

export interface ImpactScanResult {
  scannedAt: string;
  projectRoot: string;
  contextPath: string | null;
  documents: ImpactedDocument[];
  summary: ImpactScanSummary;
  warnings: string[];
}

interface ContextEntry {
  category: string | null;
  path: string;
}

const CONTEXT_SECTION_HEADER = '## Context Map';
const SECTION_PREFIX = '## ';
const CONTEXT_CANDIDATES = [
  '.cursor/context.mdc',
  'context.mdc',
  path.join('tools', 'nexus', 'context.mdc')
];

function extractSection(text: string, startHeader: string, stopPrefix: string): string | null {
  const startIndex = text.indexOf(startHeader);
  if (startIndex === -1) return null;
  const slice = text.slice(startIndex + startHeader.length);
  const stopIndex = slice.indexOf(stopPrefix);
  if (stopIndex === -1) {
    return slice.trim();
  }
  return slice.slice(0, stopIndex).trim();
}

function parseContextEntries(text: string): ContextEntry[] {
  const section = extractSection(text, CONTEXT_SECTION_HEADER, SECTION_PREFIX);
  if (!section) return [];

  const lines = section.split(/\r?\n/);
  const entries: ContextEntry[] = [];
  let currentCategory: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const categoryMatch = line.match(/^###\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    const itemMatch = line.match(/^[-\*]\s+([^\s].*?)\s+…\s+(.*)$/);
    if (itemMatch) {
      const docPath = itemMatch[1].trim();
      if (!docPath) continue;
      entries.push({
        category: currentCategory,
        path: docPath
      });
    }
  }

  return entries;
}

async function resolveContextPath(projectRoot: string, explicit?: string | null): Promise<{ path: string | null; warnings: string[]; }>
{
  const warnings: string[] = [];
  const candidates = explicit ? [explicit, ...CONTEXT_CANDIDATES] : CONTEXT_CANDIDATES;

  for (const rel of candidates) {
    if (!rel) continue;
    const target = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
    try {
      await fs.access(target);
      return { path: target, warnings };
    } catch (err) {
      if (explicit && rel === explicit) {
        warnings.push(`Specified context file not found: ${target}`);
      }
    }
  }

  warnings.push('Context file could not be resolved. Context-dependent scans may be incomplete.');
  return { path: null, warnings };
}

async function readContextFile(contextPath: string): Promise<string | null> {
  try {
    const text = await fs.readFile(contextPath, 'utf8');
    return text;
  } catch (error) {
    logger.warn('Failed to read context file for impact scan', {
      error: (error as Error).message,
      contextPath
    });
    return null;
  }
}

function summarizeDocuments(documents: ImpactedDocument[]): ImpactScanSummary {
  const summary: ImpactScanSummary = {
    total: documents.length,
    missing: 0,
    unreadable: 0,
    categories: {}
  };

  for (const doc of documents) {
    if (!doc.exists) summary.missing += 1;
    if (doc.status === 'unreadable') summary.unreadable += 1;
    if (doc.category) {
      summary.categories[doc.category] = (summary.categories[doc.category] ?? 0) + 1;
    }
  }

  return summary;
}

export async function scanQualityGateImpacts(projectRoot: string, contextOverride?: string | null): Promise<ImpactScanResult> {
  const { path: resolvedContext, warnings } = await resolveContextPath(projectRoot, contextOverride);
  let entries: ContextEntry[] = [];

  if (resolvedContext) {
    const text = await readContextFile(resolvedContext);
    if (text) {
      entries = parseContextEntries(text);
      if (entries.length === 0) {
        warnings.push('Context map section was not found in the selected context file.');
      }
    } else {
      warnings.push('Failed to read context file. Impact detection may be incomplete.');
    }
  }

  const seen = new Set<string>();
  const documents: ImpactedDocument[] = [];

  for (const entry of entries) {
    const relPath = entry.path;
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);

    const absolutePath = path.join(projectRoot, relPath);
    let exists = false;
    let status: ImpactedDocument['status'] = 'missing';
    let message: string | undefined;

    try {
      await fs.access(absolutePath);
      exists = true;
      status = 'ok';
    } catch (err) {
      exists = false;
      status = 'missing';
      message = `Document not found: ${relPath}`;
    }

    documents.push({
      path: relPath,
      absolutePath,
      category: entry.category ?? null,
      status,
      exists,
      message
    });
  }

  const summary = summarizeDocuments(documents);

  return {
    scannedAt: new Date().toISOString(),
    projectRoot,
    contextPath: resolvedContext ? path.relative(projectRoot, resolvedContext) : null,
    documents,
    summary,
    warnings
  };
}
