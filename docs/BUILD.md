# Build Pipeline

How Panopticon's TypeScript source is built into distributable artifacts.

## Build Commands

| Command | What it does |
|---------|-------------|
| `npm run build` | Full build: CLI + scripts + dashboard (frontend + server) |
| `npm run build:cli` | CLI only via tsup → `dist/cli/index.js`, `dist/index.js` |
| `npm run build:scripts` | Helper scripts via esbuild → `scripts/record-cost-event.js` |
| `npm run build:dashboard` | Dashboard frontend (Vite) + server (esbuild) |
| `npm run build:dashboard:frontend` | React frontend → `dist/dashboard/public/` |
| `npm run build:dashboard:server` | Express server → `dist/dashboard/server.js` + copies prompt templates |
| `npm run dev` | Development mode via tsx watch (runs from source, no build needed) |

## Build Tools

### tsup (CLI)

Configured in `tsup.config.ts`. Bundles the CLI and library entry points.

- **Entry points**: `src/cli/index.ts`, `src/index.ts`
- **Format**: ESM
- **Output**: `dist/cli/index.js`, `dist/index.js`
- **`clean: true`**: Wipes `dist/` before building (dashboard build runs after, so this is fine)

### esbuild (Dashboard Server)

Configured in `src/dashboard/server/esbuild.config.mjs`. Bundles the Express server into a single file.

- **Entry point**: `src/dashboard/server/index.ts`
- **Output**: `dist/dashboard/server.js`
- **Format**: ESM with CJS compatibility shims
- **External**: `node-pty`, `better-sqlite3`, `ssh2` (native modules)

### Vite (Dashboard Frontend)

Standard Vite + React build configured in `src/dashboard/frontend/`.

- **Output**: `dist/dashboard/public/`
- **TypeScript**: Checked via `tsc` before Vite build

## `__dirname` Resolution in Bundled Server

**This is a critical detail that affects runtime file resolution.**

esbuild bundles all server code into a single `dist/dashboard/server.js`. The esbuild config includes a footer that polyfills `__dirname`:

```javascript
var __dirname = (await import('path')).dirname(
  (await import('url')).fileURLToPath(import.meta.url)
);
```

This means `__dirname` in the bundled code resolves to **`dist/dashboard/`** — the directory where `server.js` lives. Any code that uses `join(__dirname, 'relative/path')` must have files placed relative to `dist/dashboard/`, not relative to the original source location.

### Specialist Prompt Templates

Specialist agents (review-agent, test-agent, merge-agent) use prompt templates stored as `.md` files in `src/lib/cloister/prompts/`. At runtime, these are loaded via:

```typescript
const templatePath = join(__dirname, 'prompts', 'merge-agent.md');
const template = readFileSync(templatePath, 'utf-8');
```

In the bundled server, `__dirname` = `dist/dashboard/`, so this looks for `dist/dashboard/prompts/merge-agent.md`. The build pipeline copies these files:

```
src/lib/cloister/prompts/*.md → dist/dashboard/prompts/
```

This copy step is part of `build:dashboard:server` in `package.json`.

**If you add a new prompt template**: Place it in `src/lib/cloister/prompts/` and it will automatically be copied during build (the `cp` command uses `*.md` glob).

### Development Mode (`npm run dev`)

In dev mode, `tsx` runs TypeScript directly from source. `__dirname` resolves to the actual source directory (e.g., `src/lib/cloister/`), so prompt templates are found without any copy step. This means **template issues only surface in production builds**.

## Output Structure

After `npm run build`:

```
dist/
├── cli/
│   └── index.js              # CLI entry point (tsup)
├── index.js                   # Library entry point (tsup)
├── dashboard/
│   ├── server.js              # Express server bundle (esbuild)
│   ├── prompts/               # Specialist prompt templates (copied)
│   │   ├── merge-agent.md
│   │   ├── review-agent.md
│   │   ├── sync-main.md
│   │   ├── test-agent.md
│   │   └── work-agent.md
│   └── public/                # React frontend (Vite)
│       ├── index.html
│       └── assets/
│           ├── index-*.css
│           └── index-*.js
├── *.js                       # CLI command chunks (tsup code-split)
└── *.js.map                   # Source maps
```

## Running the Dashboard

The dashboard server must be run from the **repository root** (not from `dist/`):

```bash
node dist/dashboard/server.js
```

It serves the frontend from `dist/dashboard/public/` and loads prompt templates from `dist/dashboard/prompts/`.

For development, `npm run dev` watches source files and restarts automatically. No build step needed.

## Adding New Assets

If new non-JS files need to be available at runtime (templates, configs, etc.):

1. Place the source file in the appropriate `src/` location
2. Add a copy step to the relevant build script in `package.json`
3. Use `mkdir -p` + `cp` (not `cp -r` which nests on re-run)
4. Verify the file is found both in dev mode (`tsx`) and production (`node dist/...`)

## Troubleshooting

**"Template not found" errors**: The prompt `.md` files are missing from `dist/dashboard/prompts/`. Run `npm run build:dashboard:server` to copy them, or do a full `npm run build`.

**"Module not found" for native modules**: `better-sqlite3`, `node-pty`, and `ssh2` are marked as external in esbuild and must be installed as runtime dependencies. Run `npm rebuild better-sqlite3` after Node.js version changes.

**Frontend not updating**: Vite builds to `dist/dashboard/public/`. If changes don't appear, clear browser cache or check that `build:dashboard:frontend` ran.
