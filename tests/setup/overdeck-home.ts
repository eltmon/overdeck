
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
const testHome = join(runRoot, `home-${workerId}`);
process.env.HOME = testHome;
mkdirSync(testHome, { recursive: true });
