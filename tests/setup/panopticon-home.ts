import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runRoot = process.env.PANOPTICON_TEST_HOME_ROOT ?? join(tmpdir(), `pan-test-root-${process.pid}`);
process.env.PANOPTICON_TEST_HOME_ROOT = runRoot;

const workerId = process.env.VITEST_POOL_ID ?? '0';
const panopticonHome = join(runRoot, `worker-${workerId}`);

process.env.PANOPTICON_HOME = panopticonHome;
mkdirSync(panopticonHome, { recursive: true });
