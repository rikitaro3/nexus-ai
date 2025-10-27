#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { collectNexusAnalyticsDataset } from '../shared/analytics-service.js';

interface CliOptions {
  outFile?: string | null;
  projectRoot?: string | null;
  compact?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { compact: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      options.outFile = argv[++i] ?? null;
    } else if (arg.startsWith('--out=')) {
      options.outFile = arg.slice('--out='.length);
    } else if (arg === '--project-root' || arg === '-r') {
      options.projectRoot = argv[++i] ?? null;
    } else if (arg.startsWith('--project-root=')) {
      options.projectRoot = arg.slice('--project-root='.length);
    } else if (arg === '--compact') {
      options.compact = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run analytics:export -- [options]\n\n` +
    `Options:\n` +
    `  -o, --out <file>         Write output JSON to a file instead of stdout\n` +
    `  -r, --project-root <p>   Explicit project root (default: auto-detect from script location)\n` +
    `      --compact            Emit compact JSON without whitespace\n` +
    `  -h, --help               Show this help message\n`);
}

function resolveProjectRoot(options: CliOptions): string {
  if (options.projectRoot) {
    return path.resolve(options.projectRoot);
  }
  const envRoot = process.env.NEXUS_PROJECT_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }
  return path.resolve(__dirname, '..', '..', '..');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(options);
  const dataset = await collectNexusAnalyticsDataset(projectRoot);
  const json = options.compact ? JSON.stringify(dataset) : JSON.stringify(dataset, null, 2);

  if (options.outFile) {
    const target = path.isAbsolute(options.outFile)
      ? options.outFile
      : path.resolve(process.cwd(), options.outFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, json, 'utf8');
    console.log(`Analytics dataset written to ${target}`);
    return;
  }

  process.stdout.write(json);
}

main().catch(error => {
  console.error('[analytics:export] Failed to collect dataset:', error?.message || error);
  process.exit(1);
});
