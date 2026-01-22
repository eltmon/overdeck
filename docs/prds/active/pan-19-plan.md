# PAN-19: pan up: Dashboard fails to start - spawn npm ENOENT

## Issue Summary

Running `pan up` fails on macOS with `spawn npm ENOENT` error (v0.3.2) or `spawn /bin/sh ENOENT` error (v0.3.4).

**GitHub Issue:** https://github.com/eltmon/panopticon-cli/issues/19

## Root Cause Analysis

### Initial Diagnosis (Wrong)
The v0.3.4 fix added `shell: true` to spawn calls, thinking the issue was PATH resolution for nvm-managed npm.

### Actual Root Cause (Correct)
The **real problem** is that the dashboard source code is **not included in the npm package**.

**Path calculation in `src/cli/index.ts` line 105:**
```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardDir = join(__dirname, '..', 'dashboard');
```

| Scenario | `__dirname` | `dashboardDir` | Exists? |
|----------|-------------|----------------|---------|
| Dev (from repo) | `src/cli/` | `src/dashboard/` | ✅ Yes |
| Global npm install | `.../dist/cli/` | `.../dist/dashboard/` | ❌ **No** |

**Why ENOENT occurs:**
- `spawn()` throws `ENOENT` when `cwd` doesn't exist
- The error `spawn /bin/sh ENOENT` is misleading - `/bin/sh` exists, but the working directory doesn't
- Node.js conflates "command not found" and "cwd not found" into the same error

**Current npm package contents (from `tsup.config.ts`):**
- `dist/cli/index.js` - CLI entry point ✅
- `dist/index.js` - SDK entry point ✅
- `dist/dashboard/` - **Missing** ❌

## Key Decisions

### 1. Fix Approach: Bundle Pre-built Dashboard

**Decision:** Include a pre-built dashboard in the npm package.

**Rationale:**
- Makes the package fully self-contained
- No runtime dependency on source code
- Better UX - `pan up` just works after `npm install -g`

### 2. Use Prebuilt node-pty Package

**Decision:** Replace `node-pty` with `@homebridge/node-pty-prebuilt-multiarch`

**Platform support:**
| Platform | Prebuilt? |
|----------|-----------|
| macOS x64 (Intel) | ✅ Yes |
| macOS arm64 (Apple Silicon) | ✅ Yes |
| Linux x64 (glibc) | ✅ Yes |
| Linux arm64 (glibc) | ✅ Yes |
| Linux musl (Alpine) | ✅ Yes |
| Windows x64 | ✅ Yes |

**Fallback:** If prebuild unavailable, node-gyp compiles from source.

### 3. Bundled Dashboard Architecture

**Decision:** Build frontend to static files, bundle server with esbuild.

```
dist/
├── cli/
│   └── index.js          # CLI entry (existing)
├── dashboard/
│   ├── server.js         # Bundled Express server
│   └── public/           # Built Vite static files
│       ├── index.html
│       └── assets/
└── index.js              # SDK entry (existing)
```

### 4. Runtime Mode Detection

**Decision:** `pan up` auto-detects production vs development mode.

```typescript
// Check for bundled dashboard (production)
const bundledDashboard = join(__dirname, '..', 'dashboard', 'server.js');
if (existsSync(bundledDashboard)) {
  // Production: run pre-built server
  spawn('node', [bundledDashboard], { ... });
} else {
  // Development: run npm dev
  spawn('npm', ['run', 'dev'], { cwd: srcDashboard, ... });
}
```

## Scope

### In Scope
- Build frontend to static files (`vite build`)
- Bundle server with esbuild (node-pty external)
- Switch to `@homebridge/node-pty-prebuilt-multiarch`
- Update `pan up` to run bundled dashboard
- Server serves static files in production mode
- Update build scripts and package.json

### Out of Scope
- Docker-based dashboard deployment
- Dashboard auto-update mechanism
- Separate `@panopticon/dashboard` npm package

### Documentation Updates
- Update README.md with platform support table
- Document that terminal streaming requires native binary

## Implementation Plan

### Phase 1: Server Modifications

**File:** `src/dashboard/server/index.ts`

1. Add static file serving for production mode:
```typescript
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

// Serve static files in production
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
}
```

2. Replace `node-pty` import:
```typescript
// Before
import * as pty from 'node-pty';

// After
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
```

### Phase 2: Build Configuration

**New file:** `src/dashboard/server/esbuild.config.mjs`
```javascript
import { build } from 'esbuild';

await build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '../../dist/dashboard/server.js',
  external: ['@homebridge/node-pty-prebuilt-multiarch'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  }
});
```

**Update:** `src/dashboard/frontend/vite.config.ts`
```typescript
export default defineConfig({
  build: {
    outDir: '../../dist/dashboard/public',
  }
});
```

### Phase 3: Package.json Updates

**Root `package.json`:**
```json
{
  "scripts": {
    "build": "npm run build:cli && npm run build:dashboard",
    "build:cli": "tsup",
    "build:dashboard": "npm run build:dashboard:frontend && npm run build:dashboard:server",
    "build:dashboard:frontend": "cd src/dashboard/frontend && npm run build",
    "build:dashboard:server": "cd src/dashboard/server && node esbuild.config.mjs"
  },
  "files": [
    "dist",
    "templates",
    "README.md",
    "LICENSE"
  ]
}
```

**`src/dashboard/server/package.json`:**
```json
{
  "dependencies": {
    "@homebridge/node-pty-prebuilt-multiarch": "^0.13.1"
  }
}
```

### Phase 4: CLI Updates

**File:** `src/cli/index.ts`

```typescript
// Find dashboard - check bundled first, then source
const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
const srcDashboard = join(__dirname, '..', '..', 'src', 'dashboard');

if (existsSync(bundledServer)) {
  // Production mode - run bundled server
  console.log(chalk.dim('Running bundled dashboard...'));
  const child = spawn('node', [bundledServer], {
    stdio: options.detach ? 'ignore' : 'inherit',
    detached: options.detach,
  });
  // ... rest of handling
} else if (existsSync(srcDashboard)) {
  // Development mode - run npm dev
  console.log(chalk.dim('Running dashboard in dev mode...'));
  const child = spawn('npm', ['run', 'dev'], {
    cwd: srcDashboard,
    stdio: options.detach ? 'ignore' : 'inherit',
    shell: true,
    detached: options.detach,
  });
  // ... rest of handling
} else {
  console.error(chalk.red('Error: Dashboard not found'));
  console.error(chalk.dim('This may be a corrupted installation. Try reinstalling panopticon-cli.'));
  process.exit(1);
}
```

## Testing Plan

1. **Build verification:**
   - `npm run build` completes without errors
   - `dist/dashboard/server.js` exists
   - `dist/dashboard/public/index.html` exists

2. **Local production test:**
   - `node dist/dashboard/server.js` starts server
   - Frontend loads at http://localhost:3001
   - WebSocket connections work
   - Terminal streaming works

3. **npm pack test:**
   - `npm pack` creates tarball
   - Extract and verify `dist/dashboard/` contents
   - Install from tarball: `npm install -g ./panopticon-cli-*.tgz`
   - `pan up` works

**Note:** Cross-platform support is handled by `@homebridge/node-pty-prebuilt-multiarch` prebuilt binaries. Manual testing on each platform is not required.

## Success Criteria

1. `npm install -g panopticon-cli` works without additional setup
2. `pan up` starts dashboard on first run
3. Dashboard fully functional (terminal streaming, Linear integration)
4. No source code or npm dependencies required at runtime
5. Package size reasonable (<50MB)

## Current Status

**Phase: PLANNING COMPLETE**

Previous fix attempts addressed wrong root cause (spawn PATH issues).
New plan addresses actual root cause (dashboard not in package).

## Beads Tasks

| ID | Title | Status | Blocked By |
|----|-------|--------|------------|
| panopticon-5pc5 | Switch server to @homebridge/node-pty-prebuilt-multiarch | open | - |
| panopticon-y33i | Add static file serving to server | open | - |
| panopticon-2fco | Create esbuild config for server bundle | open | - |
| panopticon-dy5b | Update Vite config for production output path | open | - |
| panopticon-nr36 | Add dashboard build scripts to root package.json | open | - |
| panopticon-z63a | Update pan up command for bundled mode | open | - |
| panopticon-1vmk | Update README with platform support | open | - |
| panopticon-55ct | Test build and pack locally | open | all above |

### Superseded Tasks (from previous plan)

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| panopticon-324n | Add shell: true to foreground spawn | closed | Previous fix, didn't solve root cause |
| panopticon-rsb1 | Add shell: true to background spawn | closed | Previous fix |
| panopticon-qdu3 | Add npm pre-flight check | closed | Previous fix |
| panopticon-pxqm | Add error handling for background spawn | closed | Previous fix |
| panopticon-zppl | Test on macOS with nvm | superseded | Replaced by panopticon-8mvd |
| panopticon-nnic | Test on Linux (verify no regression) | closed | Previous fix verified |

## References

- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/19
- [@homebridge/node-pty-prebuilt-multiarch](https://github.com/homebridge/node-pty-prebuilt-multiarch)
- Vite build docs: https://vitejs.dev/guide/build.html
- esbuild node bundling: https://esbuild.github.io/getting-started/#bundling-for-node
