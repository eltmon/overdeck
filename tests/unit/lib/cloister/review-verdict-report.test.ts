import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findVerdictReport,
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
