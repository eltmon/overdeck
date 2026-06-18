import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    // PAN-1664: during a `pan dev` hot-reload (PAN-1662), cleaning dist deletes
    // packages/contracts/dist/index.mjs out from under the running Vite frontend
    // (which imports @overdeck/contracts from that path), 404ing the module and
    // wedging the tab on "Reconnecting…". Skip the clean during hot-reload so the
    // rebuild overwrites in place instead of deleting first.
    clean: process.env['PAN_HOT_RELOAD'] !== '1',
    outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
    outDir: 'dist',
  },
  {
    entry: ['src/index.ts'],
    format: 'cjs',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.cjs' }),
    outDir: 'dist',
  },
]);
