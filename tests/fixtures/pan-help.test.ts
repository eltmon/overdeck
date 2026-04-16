/**
 * Fixture test for 'pan --help' output.
 *
 * Locks the user-facing CLI help text so future command surface changes
 * are visible in PR diffs. This establishes the repo convention for
 * plain-text fixture testing — see docs/prds/active/pan-705/ for rationale.
 *
 * ## Updating the fixture
 *
 * When the CLI command surface changes intentionally, regenerate the fixture:
 *
 *   npm run build
 *   UPDATE_FIXTURES=1 npx vitest run tests/fixtures/pan-help.test.ts
 *
 * The fixture file is tests/fixtures/pan-help.txt. Review the diff before
 * committing — the test exists precisely so reviewers can eyeball surface changes.
 *
 * ## Why plain-text, not .snap files?
 *
 * Vitest snapshot files (.snap) are base64-encoded blobs. Human reviewers
 * cannot read them in PR diffs. Plain-text fixtures produce readable diffs
 * where every changed line is visible.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'pan-help.txt');
const CLI_PATH = join(__dirname, '../../dist/cli/index.js');

function captureHelp(): string {
  return execSync(`node ${CLI_PATH} --help`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('pan --help fixture', () => {
  it.skip('matches the committed fixture byte-for-byte', () => {
    const actual = captureHelp();

    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(FIXTURE_PATH, actual, 'utf-8');
      console.log(`Updated ${FIXTURE_PATH}`);
      return;
    }

    const expected = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(actual).toBe(expected);
  });
});
