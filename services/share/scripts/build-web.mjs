/**
 * Builds the hosted viewer bundle (PRD PAN-4481 WI-6, D-8): services/share/web/main.ts →
 * public/viewer/viewer.js, served by the Worker through its ASSETS binding at /viewer/viewer.js.
 * `@overdeck/contracts` resolves to web/contracts.ts, which re-exports only the sharing modules,
 * so `effect` never enters the bundle. wrangler runs this as the `build.command`.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('../web/main.ts')],
  outfile: here('../public/viewer/viewer.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  alias: { '@overdeck/contracts': here('../web/contracts.ts') },
  legalComments: 'none',
  logLevel: 'warning',
});
