import type {
  DocsAutofixSummary,
  DocsAutofixOperation,
  DocsAutofixRenameEntry
} from '../src/main/utils/quality-gates.js';

export interface ApplyDocsGatesOptions {
  projectRoot: string;
  contextPath?: string | null;
  dryRun?: boolean;
}

export interface ApplyDocsGatesArgs {
  projectRoot: string | null;
  contextPath: string | null;
  dryRun: boolean;
  format: 'json' | 'table';
}

export declare function main(argv?: string[]): Promise<void>;
export declare function parseArgs(argv?: string[]): ApplyDocsGatesArgs;
export declare function applyDocsGatesAutofix(options: ApplyDocsGatesOptions): Promise<DocsAutofixSummary>;
export declare function buildRenamePlan(
  records: { relativePath: string; finalPath?: string; content: string }[]
): DocsAutofixRenameEntry[];
export declare function ensureBreadcrumbs(record: { content: string; finalPath?: string }, context: unknown): void;
export declare function normalizeLayer(record: { content: string; finalPath?: string }): void;
export declare function normalizeBreadcrumbLinks(record: { content: string }, context: unknown): Promise<void>;
export declare function enforceHeadingNumbering(record: { content: string }): void;
export declare function ensureTableOfContents(record: { content: string }): void;
export declare function ensureScopeSections(record: { content: string }): void;
export declare function breakCycles(records: { content: string; finalPath?: string }[], renameMap: Map<string, string>): void;

export type { DocsAutofixSummary, DocsAutofixOperation, DocsAutofixRenameEntry };
