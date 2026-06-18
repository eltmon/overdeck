# PAN-432: Dashboard Server Build Migration — esbuild to tsdown

## Problem

The dashboard server build uses a raw `esbuild.config.mjs` script (imperative JS calling `esbuild.build()`). This works but is the odd one out — the CLI uses tsup, the frontend uses Vite, and both have declarative configs. esbuild requires manually wiring banner/footer polyfills, externals, and output paths. tsdown (built on Rolldown, the Rust-based bundler) provides the same declarative config experience as tsup but with better performance and ESM-native support.

## Scope

**In scope:** Replace `esbuild.config.mjs` with `tsdown.config.ts` for the dashboard server build only.

**Not in scope:**
- Frontend build (stays on Vite — `vite.config.ts`)
- Cost script build (`scripts/build-cost-script.mjs` — separate esbuild invocation)
- Dev workflow (`bun run src/dashboard/server/main.ts` — unchanged)

## Current State

**Config:** `src/dashboard/server/esbuild.config.mjs`

```javascript
await build({
  entryPoints: ['main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '../../../dist/dashboard/server.js',
  external: [
    '@homebridge/node-pty-prebuilt-multiarch',
    'better-sqlite3',
    'ssh2',
    'bun:sqlite',
    '@effect/platform-bun',
    '@effect/platform-bun/BunHttpServer',
    '@effect/platform-bun/BunServices',
    '@effect/platform-bun/BunRuntime',
  ],
  banner: {
    js: `import { createRequire as __overdeckCreateRequire } from 'module';\nconst require = __overdeckCreateRequire(import.meta.url);`
  },
  footer: {
    js: `var __filename = (await import('url')).fileURLToPath(import.meta.url);\nvar __dirname = (await import('path')).dirname(__filename);`
  }
});
```

**Build command:** `cd src/dashboard/server && node esbuild.config.mjs`

**Output:** `dist/dashboard/server.js` (~7.6 MB bundled ESM)

## Implementation

### Step 1: Install tsdown

In the server workspace (`src/dashboard/server/`):

```bash
bun add --dev tsdown --cwd src/dashboard/server
```

### Step 2: Create `src/dashboard/server/tsdown.config.ts`

```typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { server: 'main.ts' },  // output as server.js (CLI expects dist/dashboard/server.js)
  outDir: '../../../dist/dashboard',
  format: 'esm',
  platform: 'node',
  shims: true,  // auto-injects __filename, __dirname, AND createRequire for ESM→CJS interop
  clean: false,  // Don't nuke dist/dashboard/public/ (frontend build)
  sourcemap: true,
  deps: {
    neverBundle: [
      // Native bindings — require() at runtime, cannot bundle
      '@homebridge/node-pty-prebuilt-multiarch',
      'better-sqlite3',
      'ssh2',
      // Bun-specific — dynamic import at runtime, not available during Node builds
      /^bun:/,
      /^@effect\/platform-bun/,
    ],
  },
});
```

**Critical details:**
- `entry: { server: 'main.ts' }` — object key becomes the output filename, producing `dist/dashboard/server.js` (matching what `src/cli/index.ts:178` expects)
- `shims: true` — replaces BOTH the esbuild banner (`createRequire`) and footer (`__filename`/`__dirname`). tsdown auto-injects `createRequire` for any `require()` calls in ESM output when `platform: 'node'`, and `__filename`/`__dirname` when `shims` is enabled. No manual banner/footer needed.
- `deps.neverBundle` — replaces esbuild's `external` option. Accepts strings and regex patterns. The regex `/^@effect\/platform-bun/` catches all deep paths (`BunHttpServer`, `BunServices`, `BunRuntime`) without listing each individually.
- `clean: false` is essential — the frontend build writes to `dist/dashboard/public/` and must not be deleted

### Step 3: Update build script

In `src/dashboard/server/package.json`, change:

```json
"build": "tsdown"
```

Remove `esbuild` from devDependencies. Add `tsdown`.

### Step 4: Verify output filename

The CLI expects `dist/dashboard/server.js` (see `src/cli/index.ts:178`). The config uses `entry: { server: 'main.ts' }` which should produce `server.js`. After the first build, verify:

```bash
ls -la dist/dashboard/server.js
```

If tsdown produces `server.mjs` instead of `server.js`, add `outExtensions` to force `.js`:

```typescript
outExtensions: () => ({ js: '.js' }),
```

(T3Code's desktop config uses this pattern.)

### Step 5: Delete old config

```bash
rm src/dashboard/server/esbuild.config.mjs
```

Also remove `esbuild.config.mjs.old` if it still exists.

### Step 6: Remove esbuild dependency

Remove `esbuild` from `src/dashboard/server/package.json` devDependencies. Run `bun install`.

## Verification

All of these must pass:

1. **Build succeeds:** `npm run build` completes without errors
2. **Output exists:** `dist/dashboard/server.js` exists and is a valid ESM file
3. **Output size:** Comparable to esbuild output (~7-8 MB). If dramatically different, investigate
4. **Server starts on Node:** `node dist/dashboard/server.js` starts, listens on 3011, `/api/health` returns `{"status":"ok"}`
5. **Server starts on Bun:** `bun run src/dashboard/server/main.ts` still works (dev mode, unchanged)
6. **Frontend loads:** `http://localhost:3011/` serves the dashboard UI
7. **WebSocket connects:** `/ws/rpc` accepts WebSocket upgrade (101 Switching Protocols)
8. **Terminal works:** Open a terminal tab in the dashboard, verify PTY output streams
9. **Native bindings work:** SQLite queries succeed (better-sqlite3), terminal spawns work (node-pty)
10. **Full test suite:** `npm test` passes (all 2000+ tests)
11. **CLI build works:** `npm run build:cli` succeeds via tsdown, `node dist/cli/index.js --version` works
12. **CLI types generated:** `dist/cli/index.d.ts` and `dist/index.d.ts` exist
13. **Frontend build unaffected:** `npm run build:dashboard:frontend` still works via Vite
13. **Prompts copied:** `dist/dashboard/prompts/` contains the cloister prompt markdown files

## Risks

All originally identified risks have been resolved by tsdown's built-in features:

- ~~**Banner/footer support**~~ — **RESOLVED.** `shims: true` auto-injects `createRequire` (for `require()` in ESM) and `__filename`/`__dirname`. No manual banner/footer needed. Docs confirm this is always-on for `platform: 'node'` ESM output (createRequire) and opt-in via `shims` (__filename/__dirname).
- ~~**Output filename**~~ — **RESOLVED.** `entry: { server: 'main.ts' }` produces `server.js`. T3Code uses this pattern. If `.mjs` extension appears, use `outExtensions: () => ({ js: '.js' })` (T3Code desktop config uses this).
- ~~**External resolution with deep paths**~~ — **RESOLVED.** `deps.neverBundle` accepts regex patterns. `/^@effect\/platform-bun/` catches all deep paths. Docs confirm regex support.
- **Dual-runtime dynamic imports:** The `main.ts` file uses `await import('@effect/platform-bun/BunRuntime')` inside a conditional. The `deps.neverBundle` regex excludes these from bundling, so they remain as runtime dynamic imports. Verify the bundler doesn't error on unresolvable dynamic imports for external packages — tsdown should skip them since they're marked external.

## Part 2: Migrate CLI build from tsup to tsdown

The CLI currently uses tsup (`tsup.config.ts` at repo root). tsdown has the same config shape — it's a near-drop-in replacement.

### Current tsup config

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  noExternal: ['@overdeck/shared'],
  tsconfig: './tsconfig.json',
});
```

### Step 7: Create `tsdown.config.ts` at repo root

```typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  noExternal: (id) => id.startsWith('@overdeck/'),
  outDir: 'dist',
});
```

**Key differences from tsup:**
- `format` is a string not array (tsdown accepts both, but string is simpler for single format)
- `noExternal` uses a function pattern (matching T3Code) to catch all `@overdeck/*` workspace packages
- `tsconfig` option may not be needed — tsdown resolves `tsconfig.json` automatically

### Step 8: Update root `package.json`

Change `build:cli` script:
```json
"build:cli": "tsdown"
```

### Step 9: Swap dependencies

In root `package.json`:
- Remove `tsup` from devDependencies
- Add `tsdown` (use catalog version if available, otherwise `^0.20.3`)
- Remove the old `tsup.config.ts` file

### Step 10: Verify CLI build

```bash
npm run build:cli
```

Must produce:
- `dist/cli/index.js` — executable CLI entry (shebang `#!/usr/bin/env node`)
- `dist/index.js` — library entry
- `dist/cli/index.d.ts` and `dist/index.d.ts` — type declarations
- Source maps

Verify `pan` command still works:
```bash
node dist/cli/index.js --version
node dist/cli/index.js status
```

## Part 3: Build contracts package with tsdown

Currently `@overdeck/contracts` is consumed as raw TypeScript — `"main": "./src/index.ts"`. This works but diverges from T3Code's pattern where contracts are precompiled. Adding a tsdown build step produces proper `.mjs` + `.cjs` + `.d.ts` outputs, making the package a proper publishable unit.

### Step 11: Add tsdown to contracts

In `packages/contracts/`:

```bash
bun add --dev tsdown --cwd packages/contracts
```

### Step 12: Add build scripts to `packages/contracts/package.json`

Update to match T3Code's pattern:

```json
{
  "scripts": {
    "dev": "tsdown src/index.ts --format esm,cjs --dts --watch --clean",
    "build": "tsdown src/index.ts --format esm,cjs --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"]
}
```

Note: `types` and the `import` export still point at raw `.ts` source — this gives TypeScript consumers (the server bundler, Vite frontend) direct access to the source types without needing a separate `tsc --build` step. Only the CJS `require` path uses the compiled output.

### Step 13: Wire contracts build into the top-level build

In root `package.json`, update the build order so contracts builds before the server:

```json
"build:contracts": "cd packages/contracts && npm run build",
"build:dashboard:server": "npm run build:contracts && cd src/dashboard/server && npm run build && mkdir -p ../../../dist/dashboard/prompts && cp ../../lib/cloister/prompts/*.md ../../../dist/dashboard/prompts/"
```

### Step 14: Verify contracts build

```bash
cd packages/contracts && npx tsdown src/index.ts --format esm,cjs --dts --clean
```

Should produce:
- `dist/index.mjs` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index.d.ts` (types)

### Contracts verification

1. `npm run build:contracts` succeeds
2. `dist/index.mjs` and `dist/index.cjs` exist in `packages/contracts/`
3. Server build still resolves `@overdeck/contracts` correctly
4. Frontend build still resolves `@overdeck/contracts` correctly
5. All tests pass — no import resolution changes

## Files Changed

| File | Action |
|------|--------|
| **Part 1: Server** | |
| `src/dashboard/server/tsdown.config.ts` | CREATE |
| `src/dashboard/server/package.json` | MODIFY — swap esbuild for tsdown, update build script |
| `src/dashboard/server/esbuild.config.mjs` | DELETE |
| `src/dashboard/server/esbuild.config.mjs.old` | DELETE (if exists) |
| **Part 2: CLI** | |
| `tsdown.config.ts` (root) | CREATE |
| `tsup.config.ts` (root) | DELETE |
| `package.json` (root) | MODIFY — swap tsup for tsdown, update `build:cli`, add `build:contracts` |
| **Part 3: Contracts** | |
| `packages/contracts/package.json` | MODIFY — add tsdown build, update exports |
| **Lockfile** | |
| `bun.lock` | AUTO-UPDATE |

No changes to source code. No changes to frontend build.
