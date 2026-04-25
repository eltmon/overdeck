# Build Pipeline

How Panopticon's TypeScript source is built into distributable artifacts.

## Build Commands

| Command | What it does |
|---------|-------------|
| `npm run build` | Full build: CLI + scripts + dashboard (frontend + server) |
| `npm run build:cli` | CLI via tsdown → `dist/cli/index.js`, `dist/index.js` |
| `npm run build:contracts` | Contracts via tsdown → `packages/contracts/dist/` (ESM + CJS) |
| `npm run build:scripts` | Helper scripts via tsdown → `scripts/record-cost-event.js` |
| `npm run build:dashboard` | Dashboard frontend (Vite) + server (tsdown) |
| `npm run build:dashboard:frontend` | React frontend → `dist/dashboard/public/` |
| `npm run build:dashboard:server` | Effect server → `dist/dashboard/server.js` + copies prompt templates |
| `npm run dev` | Development mode via tsx watch (runs from source, no build needed) |

## Build Tools

### tsdown (CLI, Server, Contracts, Scripts)

All TypeScript bundling uses [tsdown](https://tsdown.dev/) (powered by Rolldown, the Rust-based bundler). Four separate configs:

**CLI** — `tsdown.config.ts` (repo root)
- **Entry points**: `src/cli/index.ts`, `src/index.ts`
- **Format**: ESM
- **Output**: `dist/cli/index.js`, `dist/index.js`, plus type declarations
- **`shims: true`**: Auto-injects `createRequire`, `__filename`, `__dirname` for ESM→CJS interop
- **`deps.alwaysBundle`**: Workspace packages (`@panopticon/*`) are bundled into the output
- **`clean: true`**: Wipes `dist/` before building (dashboard build runs after)

**Dashboard Server** — `src/dashboard/server/tsdown.config.ts`
- **Entry point**: `main.ts` → `dist/dashboard/server.js`
- **Format**: ESM, platform: node
- **`shims: true`**: Auto-injects `createRequire`, `__filename`, `__dirname`
- **`deps.alwaysBundle`**: `@panopticon/*` workspace packages
- **`deps.neverBundle`**: Native bindings (`node-pty`, `better-sqlite3`, `ssh2`) and Bun-specific modules (`bun:*`, `@effect/platform-bun/*`)
- **`clean: false`**: Preserves `dist/dashboard/public/` (frontend build output)
- **Code-split**: Rolldown produces multiple chunks (entry + shared modules)

**Contracts** — `packages/contracts/tsdown.config.ts`
- **Entry point**: `src/index.ts`
- **Format**: ESM (`.mjs`) + CJS (`.cjs`) dual output
- **Output**: `packages/contracts/dist/`
- **Type declarations**: `.d.mts`
- Note: TypeScript consumers still import from raw source (`./src/index.ts`) via the `exports` map. Only the CJS `require` path uses compiled output.

**Cost Script** — `scripts/tsdown.config.ts`
- **Entry point**: `record-cost-event.ts` → `scripts/record-cost-event.js`
- **Standalone**: Bundles everything (including `better-sqlite3` JS wrapper) for deployment to `~/.panopticon/bin/`

### Vite (Dashboard Frontend)

Standard Vite + React build configured in `src/dashboard/frontend/`.

![Dashboard React Architecture](./diagrams/react-architecture.png)
*Dashboard frontend component hierarchy: Entry → App Shell → State (Zustand) → Transport (Effect RPC) → Feature Pages → Shared Components → Hooks*

- **Output**: `dist/dashboard/public/`
- **TypeScript**: Checked via `tsc` before Vite build

## `__dirname` Resolution in Bundled Server

**This is a critical detail that affects runtime file resolution.**

tsdown bundles server code into `dist/dashboard/server.js` (plus code-split chunks). The `shims: true` option auto-injects `__dirname` resolution for ESM:

```javascript
// Injected by tsdown shims
var __dirname = /* dirname of import.meta.url */;
```

This means `__dirname` in the bundled code resolves to **`dist/dashboard/`** — the directory where `server.js` lives. Any code that uses `join(__dirname, 'relative/path')` must have files placed relative to `dist/dashboard/`, not relative to the original source location.

### Specialist Prompt Templates

All specialist and planning prompts are stored as Mustache templates with YAML frontmatter in `src/lib/cloister/prompts/`. At runtime, callers use the unified `renderPrompt()` loader from `src/lib/cloister/prompts.ts`:

```typescript
import { renderPrompt } from './prompts.js';

const prompt = renderPrompt({
  name: 'merge',
  vars: { ISSUE_ID, BRANCH_NAME, WORKSPACE_PATH, /* ... */ },
});
```

The loader reads templates via `resolvePromptsDir()`, which handles both the dev path (`src/lib/cloister/prompts/`) and the bundled path (`dist/dashboard/prompts/`). In production, `__dirname` = `dist/dashboard/`, so templates are loaded from `dist/dashboard/prompts/<name>.md`. The build pipeline copies these files:

```
src/lib/cloister/prompts/*.md → dist/dashboard/prompts/
```

This copy step is part of `build:dashboard:server` in `package.json`.

**Template catalogue** (as of v0.5.0): `work.md`, `planning.md`, `review.md`, `test.md`, `merge.md`, `sync-main.md`, `resume-work.md`, `handoff-to-work.md`, `identity-wake.md`, plus `inspect-agent.md` (legacy ad-hoc path).

**If you add a new prompt template**: Place it in `src/lib/cloister/prompts/`, declare its `requires`/`optional` vars in frontmatter, and call `renderPrompt({ name, vars })`. Missing required vars, unknown vars, and YAML errors all throw `PromptError` at render time (fail loud). See [Prompt Templates reference](../reference/prompts.mdx) for the full authoring guide.

### Development Mode (`npm run dev`)

In dev mode, `tsx` runs TypeScript directly from source. `__dirname` resolves to the actual source directory (e.g., `src/lib/cloister/`), so prompt templates are found without any copy step. This means **template issues only surface in production builds**.

## Output Structure

After `npm run build`:

```
dist/
├── cli/
│   ├── index.js              # CLI entry point (tsdown)
│   └── index.d.ts            # CLI type declaration
├── index.js                   # Library entry point (tsdown)
├── index.d.ts                 # Library type declaration
├── dashboard/
│   ├── server.js              # Effect server entry (tsdown)
│   ├── *.js                   # Server code-split chunks (tsdown/Rolldown)
│   ├── prompts/               # Specialist prompt templates (copied)
│   │   ├── handoff-to-work.md
│   │   ├── identity-wake.md
│   │   ├── inspect-agent.md
│   │   ├── merge.md
│   │   ├── planning.md
│   │   ├── resume-work.md
│   │   ├── review.md
│   │   ├── sync-main.md
│   │   ├── test.md
│   │   └── work.md
│   └── public/                # React frontend (Vite)
│       ├── index.html
│       └── assets/
│           ├── index-*.css
│           └── index-*.js
├── *.js                       # CLI code-split chunks (tsdown/Rolldown)
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

## Electron Desktop App (`apps/desktop`)

The `apps/desktop` workspace builds the native Electron app using tsdown (for main/preload) and electron-builder (for packaging).

### Build Commands

| Command | What it does |
|---------|-------------|
| `npm run build` (from `apps/desktop/`) | Compiles main.ts + preload.ts via tsdown → `dist-electron/` |
| `dist:linux` | Packages as Linux AppImage (x64) |
| `dist:mac` | Packages as macOS DMG (arm64 + x64 universal) |
| `npm run dev` | Parallel: tsdown watch + Electron launcher |

Run all commands from `apps/desktop/` (or use workspace syntax: `bun run --cwd apps/desktop ...`).

### tsdown Config (`apps/desktop/tsdown.config.ts`)

- **Entry points**: `src/main.ts`, `src/preload.ts`
- **Format**: CJS (required by Electron's main process)
- **Output**: `dist-electron/main.js`, `dist-electron/preload.js`
- **`deps.neverBundle: ["electron"]`** — Electron is provided by the runtime, never bundled
- **`deps.alwaysBundle`**: `@panopticon/*` workspace packages (contracts etc.)

### Native Addon Rebuild

After packaging, `scripts/afterPack.cjs` runs `electron-rebuild` to recompile native addons (`node-pty`, `better-sqlite3`) against the Electron Node.js version. This is required because these addons are compiled for the system Node.js version during `bun install`, which differs from Electron's embedded Node.js ABI.

The `postinstall` script in `apps/desktop/package.json` also runs `electron-rebuild` after `bun install`.

### Extra Resources

electron-builder bundles the following into the packaged app under `resources/`:

| Source | Destination | Purpose |
|--------|-------------|---------|
| `dist/dashboard/server.js` | `resources/server/server.js` | Embedded dashboard server |
| `dist/dashboard/public/` | `resources/server/public/` | Static frontend assets |
| `apps/desktop/resources/` | `resources/resources/` | App icons |

Run `npm run build` (root) before `dist:linux` / `dist:mac` to ensure server.js and public/ are up to date.

### Dev Workflow

```bash
# Terminal 1: build root (server + frontend)
npm run build

# Terminal 2: watch Electron main/preload
cd apps/desktop && npm run dev:bundle

# Terminal 3: launch Electron (restarts when dist-electron/ changes)
cd apps/desktop && npm run dev:electron
```

In dev mode, the `BrowserWindow` loads from `VITE_DEV_SERVER_URL` (Vite HMR). In packaged mode it loads `panopticon://app/index.html` from bundled static assets.

📖 **[Full desktop app reference →](./DESKTOP-APP.md)**

## Troubleshooting

**"Template not found" errors**: The prompt `.md` files are missing from `dist/dashboard/prompts/`. Run `npm run build:dashboard:server` to copy them, or do a full `npm run build`.

**"Module not found" for native modules**: `better-sqlite3`, `node-pty`, and `ssh2` are marked as external in the tsdown config (`deps.neverBundle`) and must be installed as runtime dependencies. Run `npm rebuild better-sqlite3` after Node.js version changes.

**Frontend not updating**: Vite builds to `dist/dashboard/public/`. If changes don't appear, clear browser cache or check that `build:dashboard:frontend` ran.
