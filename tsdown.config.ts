import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: import.meta.dirname,
  encoding: 'utf8',
}).trim();
const builtAt = new Date().toISOString();

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'index': 'src/index.ts',
    'supervisor/server': 'src/supervisor/server.ts',
    'pty-supervisor': 'src/lib/channels/pty-supervisor.ts',
    'codex-app-server-host': 'src/lib/codex/app-server-host.ts',
    'acp-host': 'src/lib/acp/host.ts',
    'verification-worker': 'src/lib/cloister/verification-worker.ts',
    'lib/memory/fts-worker': 'src/lib/memory/fts-worker.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  shims: true,
  define: {
    __OVERDECK_BUILD_COMMIT__: JSON.stringify(buildCommit),
    __OVERDECK_BUILD_TIME__: JSON.stringify(builtAt),
  },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  alias: {
    '@overdeck/contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts'),
  },
  deps: {
    // PAN-3209 follow-up: effect-acp is a private, unpublished workspace package
    // (packages/effect-acp, "private": true). Left external, dist/acp-host.js
    // imported a package no consumer can install, and its `workspace:*` entry in
    // `dependencies` made `npm install @overdeck/core` fail outright. Bundle it
    // like @overdeck/*; it stays a devDependency build input.
    alwaysBundle: (id) => id.startsWith('@overdeck/') || id === 'effect-acp' || id.startsWith('effect-acp/'),
    neverBundle: ['@lydell/node-pty'],
  },
  outDir: 'dist',
});
