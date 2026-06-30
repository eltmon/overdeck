import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI_DIST = join(ROOT, 'dist/cli/index.js');
const PTY_SUPERVISOR_DIST = join(ROOT, 'dist/pty-supervisor.js');
const CONTRACTS_DIST = join(ROOT, 'packages/contracts/dist/index.mjs');

export default function setup() {
  const overdeckTestRoot = mkdtempSync(join(tmpdir(), 'pan-test-root-'));
  process.env.OVERDECK_TEST_HOME_ROOT = overdeckTestRoot;

  if (!existsSync(CONTRACTS_DIST)) {
    console.log('[global-setup] packages/contracts/dist/index.mjs missing — building contracts...');
    execSync('npm run build:contracts', { cwd: ROOT, stdio: 'inherit' });
  }

  if (!existsSync(CLI_DIST) || !existsSync(PTY_SUPERVISOR_DIST)) {
    console.log('[global-setup] CLI dist artifacts missing — building CLI...');
    execSync('npm run build:cli', { cwd: ROOT, stdio: 'inherit' });
  }

  return () => {
    rmSync(overdeckTestRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
}
