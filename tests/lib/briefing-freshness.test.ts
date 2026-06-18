import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendFreshBriefingUpdate,
  BRIEFING_UPDATE_TAG,
  recordBriefingSessionStart,
} from '../../src/lib/briefing-freshness.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-briefing-freshness-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('briefing freshness', () => {
  it('injects a changed briefing once until the file mtime advances again', async () => {
    const sessionId = 'session-briefing-1';
    const briefingPath = join(tempDir!, 'session-context.md');
    const startedAt = new Date('2026-05-25T10:00:00.000Z');
    const firstMtime = new Date('2026-05-25T10:01:00.000Z');
    const secondMtime = new Date('2026-05-25T10:02:00.000Z');

    await writeFile(briefingPath, '# First briefing\n', 'utf8');
    await utimes(briefingPath, firstMtime, firstMtime);
    await recordBriefingSessionStart({ sessionId, now: startedAt });

    const first = await appendFreshBriefingUpdate({ sessionId, context: '<memory>context</memory>' });
    expect(first.injected).toBe(true);
    expect(first.context).toContain('<memory>context</memory>');
    expect(first.context).toContain(`<${BRIEFING_UPDATE_TAG}`);
    expect(first.context).toContain('# First briefing');
    expect(first.context.match(new RegExp(`<${BRIEFING_UPDATE_TAG}`, 'g'))).toHaveLength(1);

    const repeated = await appendFreshBriefingUpdate({ sessionId, context: '<memory>context</memory>' });
    expect(repeated).toMatchObject({ injected: false, context: '<memory>context</memory>' });

    await writeFile(briefingPath, '# Second briefing\n', 'utf8');
    await utimes(briefingPath, secondMtime, secondMtime);

    const changed = await appendFreshBriefingUpdate({ sessionId, context: '' });
    expect(changed.injected).toBe(true);
    expect(changed.context).toContain('# Second briefing');
  });

  it('does not inject briefing content that predates the session start', async () => {
    const sessionId = 'session-briefing-2';
    const briefingPath = join(tempDir!, 'session-context.md');
    const startedAt = new Date('2026-05-25T10:00:00.000Z');
    const oldMtime = new Date('2026-05-25T09:59:00.000Z');

    await writeFile(briefingPath, '# Old briefing\n', 'utf8');
    await utimes(briefingPath, oldMtime, oldMtime);
    await recordBriefingSessionStart({ sessionId, now: startedAt });

    const result = await appendFreshBriefingUpdate({ sessionId, context: 'existing context' });

    expect(result).toMatchObject({ injected: false, context: 'existing context' });
  });
});
