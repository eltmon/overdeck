import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI_DIST = join(ROOT, 'dist/cli/index.js');
const PTY_SUPERVISOR_DIST = join(ROOT, 'dist/pty-supervisor.js');
const CONTRACTS_DIST = join(ROOT, 'packages/contracts/dist/index.mjs');

function distEntryComplete(entryPath: string): boolean {
  if (!existsSync(entryPath)) return false;

  const source = readFileSync(entryPath, 'utf8');
  const importPattern = /\bfrom\s+['"](\.\.?\/[^'"]+\.js)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    if (!existsSync(resolve(dirname(entryPath), match[1]))) {
      return false;
    }
  }

  return true;
}

export default function setup() {
  const overdeckTestRoot = mkdtempSync(join(tmpdir(), 'pan-test-root-'));
  process.env.OVERDECK_TEST_HOME_ROOT = overdeckTestRoot;

  if (!existsSync(CONTRACTS_DIST)) {
    console.log('[global-setup] packages/contracts/dist/index.mjs missing — building contracts...');
    execSync('npm run build:contracts', { cwd: ROOT, stdio: 'inherit' });
  }

  if (!distEntryComplete(CLI_DIST) || !distEntryComplete(PTY_SUPERVISOR_DIST)) {
    console.log('[global-setup] CLI dist artifacts missing — building CLI...');
    execSync('npm run build:cli', { cwd: ROOT, stdio: 'inherit' });
  }

  return () => {
    rmSync(overdeckTestRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
}
