/**
 * The dashboard's Tailwind config with absolute content globs (PAN-4837 D-2). The frontend's own
 * globs are relative to the process cwd, so the app scans its own source and the frontend source
 * it renders.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import frontendConfig from '../../src/dashboard/frontend/tailwind.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  ...frontendConfig,
  content: [
    path.join(here, 'index.html'),
    path.join(here, 'src/**/*.{ts,tsx}'),
    path.resolve(here, '../../src/dashboard/frontend/src/**/*.{ts,tsx}'),
  ],
};
