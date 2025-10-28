#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const yaml = require('js-yaml');

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.template) {
    console.error('テンプレートIDまたはパスを --template で指定してください');
    process.exit(1);
  }
  if (!args.output) {
    console.error('出力先ファイルを --output で指定してください');
    process.exit(1);
  }

  const projectRoot = path.resolve(args.projectRoot || process.cwd());
  const template = await loadTemplate(args.template, projectRoot);
  const frontMatter = buildFrontMatter(template, args);
  const body = renderBody(template, frontMatter);
  const documentText = stringifyDocument(frontMatter, body);

  const outputPath = path.isAbsolute(args.output)
    ? args.output
    : path.join(projectRoot, args.output);

  if (!args.force) {
    try {
      await fs.access(outputPath);
      console.error(`出力先ファイルが既に存在します: ${outputPath}\n--force オプションで上書きできます`);
      process.exit(1);
    } catch {}
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, documentText, 'utf8');
  console.log(`テンプレート "${template.id || 'unnamed'}" からドキュメントを生成しました: ${outputPath}`);
}

function parseArgs(argv) {
  const args = {
    template: null,
    output: null,
    title: null,
    layer: null,
    upstream: [],
    downstream: [],
    tags: [],
    extra: {},
    projectRoot: null,
    force: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--template' || arg === '-t') {
      args.template = argv[++i];
    } else if (arg.startsWith('--template=')) {
      args.template = arg.split('=')[1];
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg === '--title') {
      args.title = argv[++i];
    } else if (arg.startsWith('--title=')) {
      args.title = arg.split('=')[1];
    } else if (arg === '--layer') {
      args.layer = argv[++i];
    } else if (arg.startsWith('--layer=')) {
      args.layer = arg.split('=')[1];
    } else if (arg === '--upstream') {
      args.upstream = args.upstream.concat(parseListArg(argv[++i]));
    } else if (arg.startsWith('--upstream=')) {
      args.upstream = args.upstream.concat(parseListArg(arg.split('=')[1]));
    } else if (arg === '--downstream') {
      args.downstream = args.downstream.concat(parseListArg(argv[++i]));
    } else if (arg.startsWith('--downstream=')) {
      args.downstream = args.downstream.concat(parseListArg(arg.split('=')[1]));
    } else if (arg === '--tags') {
      args.tags = args.tags.concat(parseListArg(argv[++i]));
    } else if (arg.startsWith('--tags=')) {
      args.tags = args.tags.concat(parseListArg(arg.split('=')[1]));
    } else if (arg === '--set') {
      mergeKeyValue(args.extra, argv[++i]);
    } else if (arg.startsWith('--set=')) {
      mergeKeyValue(args.extra, arg.split('=')[1]);
    } else if (arg === '--project-root' || arg === '-r') {
      args.projectRoot = argv[++i];
    } else if (arg.startsWith('--project-root=')) {
      args.projectRoot = arg.split('=')[1];
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  args.upstream = dedupeList(args.upstream);
  args.downstream = dedupeList(args.downstream);
  args.tags = dedupeList(args.tags);

  return args;
}

function parseListArg(value) {
  if (!value) return [];
  return String(value)
    .split(/[,、]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function mergeKeyValue(target, raw) {
  if (!raw) return;
  const [key, ...rest] = raw.split('=');
  if (!key) return;
  target[key.trim()] = rest.join('=').trim();
}

function dedupeList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function loadTemplate(templateIdOrPath, projectRoot) {
  const candidates = [];
  if (templateIdOrPath.endsWith('.yaml') || templateIdOrPath.endsWith('.yml')) {
    candidates.push(path.isAbsolute(templateIdOrPath)
      ? templateIdOrPath
      : path.join(projectRoot, templateIdOrPath));
  } else {
    candidates.push(path.join(projectRoot, 'docs', 'templates', `${templateIdOrPath}.yaml`));
  }

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf8');
      const data = yaml.load(content) || {};
      data.id = data.id || templateIdOrPath;
      data.__templatePath = candidate;
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`テンプレートを読み込めませんでした (${candidate}): ${error.message}`);
        process.exit(1);
      }
    }
  }

  console.error(`テンプレートが見つかりません: ${templateIdOrPath}`);
  process.exit(1);
}

function buildFrontMatter(template, args) {
  const defaults = typeof template.defaults === 'object' && template.defaults !== null
    ? template.defaults
    : {};
  const frontMatter = { ...defaults, ...args.extra };

  if (template.layer && !frontMatter.layer) {
    frontMatter.layer = template.layer;
  }
  if (args.layer) {
    frontMatter.layer = args.layer;
  }

  if (Array.isArray(defaults.upstream)) {
    frontMatter.upstream = defaults.upstream.slice();
  }
  if (args.upstream.length > 0) {
    frontMatter.upstream = mergeLists(frontMatter.upstream, args.upstream);
  }

  if (Array.isArray(defaults.downstream)) {
    frontMatter.downstream = defaults.downstream.slice();
  }
  if (args.downstream.length > 0) {
    frontMatter.downstream = mergeLists(frontMatter.downstream, args.downstream);
  }

  if (Array.isArray(defaults.tags)) {
    frontMatter.tags = defaults.tags.slice();
  }
  if (args.tags.length > 0) {
    frontMatter.tags = mergeLists(frontMatter.tags, args.tags);
  }

  frontMatter.title = args.title || frontMatter.title || template.title || '新規ドキュメント';
  frontMatter.template = template.id || template.template || frontMatter.template;

  if (!Array.isArray(frontMatter.upstream)) {
    frontMatter.upstream = [];
  }
  if (!Array.isArray(frontMatter.downstream)) {
    frontMatter.downstream = [];
  }
  if (!Array.isArray(frontMatter.tags)) {
    frontMatter.tags = [];
  }

  return frontMatter;
}

function mergeLists(base = [], additions = []) {
  const set = new Set();
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

function renderBody(template, frontMatter) {
  const raw = typeof template.content === 'string' ? template.content : '';
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === 'upstream' || key === 'downstream' || key === 'tags') {
      const value = frontMatter[key];
      return Array.isArray(value) ? value.join(', ') : '';
    }
    const replaced = frontMatter[key];
    return typeof replaced === 'string' ? replaced : '';
  });
}

function stringifyDocument(frontMatter, body) {
  const header = yaml.dump(frontMatter, { lineWidth: 100 }).trimEnd();
  return `---\n${header}\n---\n\n${body.replace(/\s+$/u, '')}\n`;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-doc-from-template.js --template <id> --output <path> [options]\n\n` +
    `Options:\n` +
    `  -t, --template <id|path>   テンプレートIDまたはYAMLファイルパス\n` +
    `  -o, --output <path>        出力ファイルパス (.mdc)\n` +
    `      --title <title>        ドキュメントタイトル\n` +
    `      --layer <layer>        Layer (PRD/ARCH/... )\n` +
    `      --upstream <paths>     カンマ区切りでUpstreamを指定\n` +
    `      --downstream <paths>   カンマ区切りでDownstreamを指定\n` +
    `      --tags <tags>          カンマ区切りのタグ\n` +
    `      --set key=value        任意フィールドを追加 (複数指定可)\n` +
    `  -r, --project-root <path>  プロジェクトルート (既定: 現在のディレクトリ)\n` +
    `      --force                既存ファイルを上書き\n` +
    `  -h, --help                 ヘルプを表示\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('ドキュメント生成に失敗しました:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  loadTemplate,
  buildFrontMatter,
  renderBody,
  stringifyDocument
};
