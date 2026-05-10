import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI_DIST = join(ROOT, 'dist/cli/index.js');
const CONTRACTS_DIST = join(ROOT, 'packages/contracts/dist/index.mjs');

export default function setup() {
  if (!existsSync(CONTRACTS_DIST)) {
    console.log('[global-setup] packages/contracts/dist/index.mjs missing — building contracts...');
    execSync('npm run build:contracts', { cwd: ROOT, stdio: 'inherit' });
  }

  if (!existsSync(CLI_DIST)) {
    console.log('[global-setup] dist/cli/index.js missing — building CLI...');
    execSync('npm run build:cli', { cwd: ROOT, stdio: 'inherit' });
  }
}
