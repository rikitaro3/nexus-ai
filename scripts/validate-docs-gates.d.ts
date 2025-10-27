export interface QualityGateResult {
  path: string;
  message?: string;
  severity: 'error' | 'warn';
  [key: string]: unknown;
}

export interface QualityGateResults {
  [gateId: string]: QualityGateResult[];
}

export interface ContextEntry {
  category: string;
  path: string;
  description: string;
}

export interface BreadcrumbParseResult {
  nodes: Map<string, any>;
  docStatus: Map<string, any>;
  docContents: Map<string, string>;
}

export interface ValidateTestCaseOptions {
  testRoots?: string[];
}

export function main(argv?: string[]): Promise<void>;
export function parseArgs(argv?: string[]): {
  contextPath: string | null;
  projectRoot: string | null;
  format: string;
  testRoots: string[];
};
export function parseContextEntries(text: string): ContextEntry[];
export function parseAllBreadcrumbs(entries: ContextEntry[], projectRoot: string): Promise<BreadcrumbParseResult>;
export function createEmptyGateResults(): QualityGateResults;
export function validateDocumentGates(nodes: Map<string, any>, docStatus: Map<string, any>, docContents: Map<string, string>, results: QualityGateResults): void;
export function validateTestCaseGates(projectRoot: string, results: QualityGateResults, options?: ValidateTestCaseOptions): Promise<QualityGateResults>;
export const constants: Record<string, unknown>;
