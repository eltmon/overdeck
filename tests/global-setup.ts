import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI_DIST = join(ROOT, 'dist/cli/index.js');

export default function setup() {
  if (!existsSync(CLI_DIST)) {
    console.log('[global-setup] dist/cli/index.js missing — building CLI...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }
}
