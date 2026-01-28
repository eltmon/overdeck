import { build } from 'esbuild';

await build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '../../../dist/dashboard/server.js',
  external: ['@homebridge/node-pty-prebuilt-multiarch', 'better-sqlite3'],
  banner: {
    js: `import { createRequire } from 'module';
const require = createRequire(import.meta.url);`
  },
  // Inject __filename and __dirname for CJS compatibility (used by bindings package)
  // Using var so it doesn't conflict with redeclarations in bundled modules
  footer: {
    js: `// Polyfill __filename and __dirname for CJS dependencies at global scope
var __filename = (await import('url')).fileURLToPath(import.meta.url);
var __dirname = (await import('path')).dirname(__filename);`
  }
});

console.log('Server bundled successfully');
