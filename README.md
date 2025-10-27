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
cd tools/nexus
npm install
```

### Build (TypeScript)

```bash
npm run build
```

This compiles `main.ts` to `dist/main.js`.

### Run

```bash
npm start              # Run (uses dist/main.js)
npm run start:dev      # Build + Run
```

### E2E Tests

```bash
npm run test:e2e:playwright
```

## File Structure

```
nexus/
├── src/
│   ├── main/           # Main Process (TypeScript)
│   │   └── main.ts
│   ├── preload/        # Preload script (TypeScript)
│   │   └── preload.ts
│   └── renderer/       # Renderer Process UI
│       ├── index.html
│       ├── styles/
│       │   └── app.css
│       ├── features/
│       │   ├── docs-navigator/
│       │   │   └── docs-navigator.js
│       │   └── tasks/
│       │       └── tasks.js
│       └── shared/
│           └── app.js
├── dist/               # Compiled TypeScript output
├── docs/               # Documentation
└── tasks.json          # Tasks data
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
1. Make sure `dist/main.js` exists: `npm run build`
2. Check that renderer files are in `renderer/` folder
3. Verify paths in `main.ts` are correct for TypeScript output

