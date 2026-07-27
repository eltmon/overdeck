import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findVerdictReport,
  parseVerdictReport,
} from '../../../../src/lib/cloister/review-verdict-report.js';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'review-verdict-report-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('parseVerdictReport', () => {
  it.each(['APPROVED', 'PASSED'])('maps %s to passed', (label) => {
    expect(parseVerdictReport(`## Verdict: ${label}`)).toEqual({
      verdict: 'passed',
      topBlocker: '',
    });
  });

  it('maps a changes-requested suffix to the top blocker', () => {
    expect(parseVerdictReport('## Verdict: CHANGES REQUESTED — auth bypass in routes/agents.ts')).toEqual({
      verdict: 'blocked',
      topBlocker: 'auth bypass in routes/agents.ts',
    });
  });

  it('falls back to the first Blocking Findings section title', () => {
    const content = [
      '## Verdict: CHANGES REQUESTED',
      '',
      '## Blocking Findings',
      '',
      '### [correctness] Verdict status is never persisted',
      'The synthesis remains unapplied.',
      '',
      '## Advisory Findings',
      'None.',
    ].join('\n');

    expect(parseVerdictReport(content)).toEqual({
      verdict: 'blocked',
      topBlocker: '[correctness] Verdict status is never persisted',
    });
  });

  it('maps FAILED to failed', () => {
    expect(parseVerdictReport('## Verdict: FAILED')).toEqual({
      verdict: 'failed',
      topBlocker: '',
    });
  });

  it('returns null for unrecognized content', () => {
    expect(parseVerdictReport('## Verdict: MAYBE\n\nNo actionable result.')).toBeNull();
    expect(parseVerdictReport('This is not a verdict report.')).toBeNull();
  });
});

describe('findVerdictReport', () => {
  it('prefers synthesis.md when both report files exist', async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, 'synthesis.md'), 'synthesis');
    await writeFile(join(directory, 'review.md'), 'review');

    expect(findVerdictReport(directory)).toEqual({
      path: join(directory, 'synthesis.md'),
      filename: 'synthesis.md',
    });
  });

  it('falls back to review.md', async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, 'review.md'), 'review');

    expect(findVerdictReport(directory)).toEqual({
      path: join(directory, 'review.md'),
      filename: 'review.md',
    });
  });

  it('returns null when neither report file exists', async () => {
    const directory = await makeTemporaryDirectory();

    expect(findVerdictReport(directory)).toBeNull();
  });
});
