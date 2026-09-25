
import { mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const runRoot = process.env.OVERDECK_TEST_HOME_ROOT ?? join(tmpdir(), `pan-test-root-${process.pid}`);
process.env.OVERDECK_TEST_HOME_ROOT = runRoot;

const workerId = process.env.VITEST_POOL_ID ?? '0';
const overdeckHome = join(runRoot, `worker-${workerId}`);

process.env.OVERDECK_HOME = overdeckHome;
mkdirSync(overdeckHome, { recursive: true });

// HOME is a temp dir too, so code that writes under the home directory (e.g.
// the Claude Code pre-trust into ~/.claude.json, PAN-3905) never reaches the
// operator's real files. Record the real home first: the write guard in
// no-real-home-writes.ts protects it. Kept apart from OVERDECK_HOME so the
// temp home's `.overdeck` is never the test's Overdeck home.
process.env.OVERDECK_TEST_REAL_HOME ??= homedir();
// Browsers installed under the real home's cache stay usable.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(
  process.env.XDG_CACHE_HOME ?? join(process.env.OVERDECK_TEST_REAL_HOME, '.cache'),
  'ms-playwright',
);
const testHome = join(runRoot, `home-${workerId}`);
process.env.HOME = testHome;
mkdirSync(testHome, { recursive: true });
// A test that unsets OVERDECK_HOME falls back to `<temp HOME>/.overdeck`, which
// counts as the default home and would pick the operator's shared tmux socket
// and pin the temp HOME in its global env (PAN-1798/PAN-3671). An explicit
// per-worker socket keeps every test off it. Tests of the socket derivation
// unset this themselves.
process.env.OVERDECK_TMUX_SOCKET_NAME ??= `overdeck-test-${process.pid}-${workerId}`;
