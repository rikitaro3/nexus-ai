# Nexus

Document navigator and tasks management tool for multi-repository development projects.

## Features

- **Docs Navigator**: Browse documents by category, view details, and open files
- **FEAT Cross-reference**: View feature coverage across PRD/UX/API/DATA/QA
- **Orphan Detection**: Find documents with missing upstream/downstream links
- **Tree View**: Visualize document relationships (DAG)
- **Tasks Management**: Import, edit, save, and export tasks
- **Breakdown Generation**: Generate prompts for AI task breakdown

## Development

### Setup

```bash
npm install
```

### Build (TypeScript)

```bash
npm run build
```

This compiles the Electron main and preload processes into `dist/`.

### Run

```bash
npm start              # Run (uses dist/main.js)
npm run start:dev      # Build + Run
```

### Context Map Format

Nexus supports both YAML and Markdown formats for Context Map files.

### YAML Format (Recommended)

```yaml
version: "1.0"
contextMap:
  - category: "プロジェクト基盤"
    entries:
      - path: ".cursor/global.mdc"
        description: "プロジェクトの設計原則"
```

Advantages:
- No regex parsing needed (more robust)
- Easy to extend with metadata
- Human-readable structure

### Markdown Format (Legacy)

```markdown
## Context Map

### プロジェクト基盤
- .cursor/global.mdc … プロジェクトの設計原則
```

### Converting Markdown to YAML

Use the conversion script to migrate existing context files:

```bash
node scripts/convert-context-to-yaml.js <input.mdc> [output.yaml]
```

Example:
```bash
node scripts/convert-context-to-yaml.js ../../.cursor/context.mdc ../../.cursor/context.yaml
```

See [docs/ARCH/ContextMapSpec.mdc](docs/ARCH/ContextMapSpec.mdc) for detailed specification.

## Quality Gates Validation (CLI)

Run the documentation quality gates without launching the GUI:

```bash
npm run validate:docs            # Human-readable summary
npm run validate:docs -- --json  # JSON output for automation
```

Options:

- `--context <path>` – specify an alternate `context.mdc` or `context.yaml` file.
- `--project-root <path>` – override the project root for resolving document paths.

### E2E Tests

```bash
npm run test:e2e:playwright
```

## File Structure

```
src/
├── main/           # Main Process (TypeScript)
│   └── main.ts
├── preload/        # Preload script (TypeScript)
│   └── preload.ts
└── renderer/       # Renderer Process UI (HTML/JS/CSS)
    ├── index.html
    ├── styles/
    │   └── app.css
    ├── features/
    │   ├── docs-navigator/
    │   │   └── docs-navigator.js
    │   └── tasks/
    │       └── tasks.js
    └── shared/
        └── app.js
docs/               # Documentation
test/               # Playwright, integration, and unit tests
legacy/             # Archived pre-TypeScript assets
context.mdc         # Nexus context map
```

## Current Status

✅ TypeScript build working
⚠️ E2E tests need debugging (Tree view not rendering)
✅ Manual testing confirmed working

## Repository Management

This repository can be used as a Git submodule in parent projects.

### Using as a Submodule

Add to parent project:
```bash
git submodule add <nexus-ai-repo-url> tools/nexus
```

Initialize after cloning parent:
```bash
git submodule init
git submodule update
```

Or clone with submodules:
```bash
git clone --recurse-submodules <parent-repo-url>
```

Update submodule reference:
```bash
cd tools/nexus
git pull origin main
cd ../..
git add tools/nexus
git commit -m "Update nexus submodule"
```

## Troubleshooting

If you see blank screen:
1. Make sure `dist/` exists: `npm run build`
2. Check that renderer files are in `src/renderer/`
3. Verify paths in `src/main/main.ts` are correct for TypeScript output

