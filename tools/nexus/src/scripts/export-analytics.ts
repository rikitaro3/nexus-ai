import fs from 'fs';
import path from 'path';
import { collectAnalytics } from '../common/analytics-service.js';

interface CliOptions {
  outputPath?: string;
  projectRoot?: string;
  persistHistory: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { persistHistory: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '--output') {
      opts.outputPath = argv[i + 1];
      i += 1;
    } else if (arg === '--root') {
      opts.projectRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--no-history') {
      opts.persistHistory = false;
    }
  }
  return opts;
}

function resolveProjectRoot(optionRoot?: string): string {
  if (optionRoot) return path.resolve(optionRoot);
  if (process.env.NEXUS_PROJECT_ROOT) {
    return path.resolve(process.env.NEXUS_PROJECT_ROOT);
  }
  // dist/src/scripts -> dist/src -> dist -> tools/nexus -> tools -> repo
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const metrics = await collectAnalytics({ projectRoot, persistHistory: options.persistHistory });
  const defaultTarget = path.join(projectRoot, 'tools', 'nexus', 'analytics-report.json');
  const target = options.outputPath
    ? path.isAbsolute(options.outputPath)
      ? options.outputPath
      : path.resolve(projectRoot, options.outputPath)
    : defaultTarget;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(metrics, null, 2), 'utf8');

  process.stdout.write(`Analytics metrics exported to ${target}\n`);
}

main().catch(err => {
  console.error('Failed to export analytics metrics:', err);
  process.exitCode = 1;
});
