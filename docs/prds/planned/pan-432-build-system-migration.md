# PAN-432: Dashboard Server Build Migration — esbuild to tsdown

## Problem

The dashboard server build uses a raw `esbuild.config.mjs` script (imperative JS calling `esbuild.build()`). This works but is the odd one out — the CLI uses tsup, the frontend uses Vite, and both have declarative configs. esbuild requires manually wiring banner/footer polyfills, externals, and output paths. tsdown (built on Rolldown, the Rust-based bundler) provides the same declarative config experience as tsup but with better performance and ESM-native support.

## Scope

**In scope:** Replace `esbuild.config.mjs` with `tsdown.config.ts` for the dashboard server build only.

**Not in scope:**
- CLI build (stays on tsup — `tsup.config.ts`)
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
    js: `import { createRequire as __panopticonCreateRequire } from 'module';\nconst require = __panopticonCreateRequire(import.meta.url);`
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
  entry: ['main.ts'],
  outDir: '../../../dist/dashboard',
  format: 'esm',
  platform: 'node',
  clean: false,  // Don't nuke dist/dashboard/public/ (frontend build)
  sourcemap: true,
  external: [
    // Native bindings — require() at runtime, cannot bundle
    '@homebridge/node-pty-prebuilt-multiarch',
    'better-sqlite3',
    'ssh2',
    // Bun-specific — dynamic import at runtime, not available during Node builds
    'bun:sqlite',
    '@effect/platform-bun',
    '@effect/platform-bun/BunHttpServer',
    '@effect/platform-bun/BunServices',
    '@effect/platform-bun/BunRuntime',
  ],
  banner: {
    js: [
      "import { createRequire as __panopticonCreateRequire } from 'module';",
      "const require = __panopticonCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  footer: {
    js: [
      "var __filename = (await import('url')).fileURLToPath(import.meta.url);",
      "var __dirname = (await import('path')).dirname(__filename);",
    ].join('\n'),
  },
});
```

**Critical details:**
- `outDir` must be `../../../dist/dashboard` so the output lands at `dist/dashboard/main.js`
- If tsdown names the output `main.js` instead of `server.js`, either use tsdown's `outputFileName` option or rename in the build script
- `clean: false` is essential — the frontend build writes to `dist/dashboard/public/` and must not be deleted
- The banner injects `createRequire` so that `better-sqlite3` and `node-pty` can use `require()` from ESM
- The footer injects `__filename`/`__dirname` because native bindings reference them

### Step 3: Update build script

In `src/dashboard/server/package.json`, change:

```json
"build": "tsdown"
```

Remove `esbuild` from devDependencies. Add `tsdown`.

### Step 4: Handle output filename

The CLI expects `dist/dashboard/server.js` (see `src/cli/index.ts:178`). tsdown may output `main.js` (matching the entry point name). Options:

1. **Preferred:** Use tsdown's entry config to control the output name: `entry: { server: 'main.ts' }` — this should produce `dist/dashboard/server.js`
2. **Fallback:** Update the build script to rename: `tsdown && mv ../../../dist/dashboard/main.js ../../../dist/dashboard/server.js`
3. **Last resort:** Update `src/cli/index.ts:178` to reference `server.js` or `main.js` (whichever tsdown produces)

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
11. **CLI build unaffected:** `npm run build:cli` still works via tsup
12. **Frontend build unaffected:** `npm run build:dashboard:frontend` still works via Vite
13. **Prompts copied:** `dist/dashboard/prompts/` contains the cloister prompt markdown files

## Risks

- **tsdown banner/footer support:** Verify tsdown supports `banner` and `footer` options. If not, use a wrapper script that prepends/appends the polyfills after bundling.
- **Output filename:** tsdown may not support custom output filenames the same way esbuild does. Test the `entry: { server: 'main.ts' }` approach first.
- **External resolution:** Verify that externaled packages with deep paths (e.g., `@effect/platform-bun/BunHttpServer`) are correctly excluded. tsdown might need glob patterns instead.
- **Dual-runtime dynamic imports:** The `main.ts` file uses `await import('@effect/platform-bun/BunRuntime')` inside a conditional. Verify the bundler doesn't try to resolve this at build time.

## Part 2: Build contracts package with tsdown

Currently `@panopticon/contracts` is consumed as raw TypeScript — `"main": "./src/index.ts"`. This works but diverges from T3Code's pattern where contracts are precompiled. Adding a tsdown build step produces proper `.mjs` + `.cjs` + `.d.ts` outputs, making the package a proper publishable unit.

### Step 7: Add tsdown to contracts

In `packages/contracts/`:

```bash
bun add --dev tsdown --cwd packages/contracts
```

### Step 8: Add build scripts to `packages/contracts/package.json`

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

### Step 9: Wire contracts build into the top-level build

In root `package.json`, update the build order so contracts builds before the server:

```json
"build:contracts": "cd packages/contracts && npm run build",
"build:dashboard:server": "npm run build:contracts && cd src/dashboard/server && npm run build && mkdir -p ../../../dist/dashboard/prompts && cp ../../lib/cloister/prompts/*.md ../../../dist/dashboard/prompts/"
```

### Step 10: Verify contracts build

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
3. Server build still resolves `@panopticon/contracts` correctly
4. Frontend build still resolves `@panopticon/contracts` correctly
5. All tests pass — no import resolution changes

## Files Changed

| File | Action |
|------|--------|
| `src/dashboard/server/tsdown.config.ts` | CREATE |
| `src/dashboard/server/package.json` | MODIFY — swap esbuild for tsdown, update build script |
| `src/dashboard/server/esbuild.config.mjs` | DELETE |
| `src/dashboard/server/esbuild.config.mjs.old` | DELETE (if exists) |
| `packages/contracts/package.json` | MODIFY — add tsdown build, update exports |
| `package.json` (root) | MODIFY — add `build:contracts` script, wire into build order |
| `bun.lock` | AUTO-UPDATE |

No changes to source code. No changes to CLI or frontend build.
