import { build } from 'esbuild';

await build({
  entryPoints: ['main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '../../../dist/dashboard/server.js',
  external: ['@homebridge/node-pty-prebuilt-multiarch', 'better-sqlite3', 'ssh2', 'bun:sqlite', '@effect/platform-bun', '@effect/platform-bun/BunHttpServer', '@effect/platform-bun/BunServices', '@effect/platform-bun/BunRuntime'],
  banner: {
    js: `import { createRequire as __panopticonCreateRequire } from 'module';
const require = __panopticonCreateRequire(import.meta.url);`
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
