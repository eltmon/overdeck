import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/record-cost-event.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'scripts/record-cost-event.js',
  // Do NOT externalize better-sqlite3 — this script runs standalone from ~/.panopticon/bin/
  // where node_modules is not available. The createRequire banner handles CJS require() calls.
  banner: {
    js: `import { createRequire } from 'module';
const require = createRequire(import.meta.url);`
  },
});

console.log('record-cost-event.js bundled successfully');
