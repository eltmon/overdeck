import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionFilePath } from '../paths.js';
import { captureTranscriptUserRecordSnapshot, hasNewTranscriptUserRecord } from '../transcript-landing.js';

let tmpHome: string;
let originalHome: string | undefined;

const workspace = '/tmp/pan-transcript-workspace';
const sessionId = '00000000-0000-4000-8000-000000000001';

function writeSession(lines: unknown[] | string): string {
  const sessionFile = sessionFilePath(workspace, sessionId);
  mkdirSync(dirname(sessionFile), { recursive: true });
  const content = typeof lines === 'string'
    ? lines
    : `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;
  writeFileSync(sessionFile, content, 'utf8');
  return sessionFile;
}

function userRecord(text: string, uuid: string): unknown {
  return {
    type: 'user',
    uuid,
    timestamp: `2026-06-10T00:00:0${uuid.slice(-1)}.000Z`,
    message: { role: 'user', content: text },
  };
}

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-transcript-landing-'));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('transcript landing snapshots', () => {
  it('returns safe defaults for missing, empty, and mid-write JSONL files', async () => {
    await expect(captureTranscriptUserRecordSnapshot(workspace, sessionId)).resolves.toMatchObject({
      sessionFile: sessionFilePath(workspace, sessionId),
      userRecordCount: 0,
    });

    writeSession('');
    await expect(captureTranscriptUserRecordSnapshot(workspace, sessionId)).resolves.toMatchObject({ userRecordCount: 0 });

    writeSession(`${JSON.stringify(userRecord('landed', 'u1'))}\n{"type":"user"`);
    await expect(captureTranscriptUserRecordSnapshot(workspace, sessionId)).resolves.toMatchObject({
      userRecordCount: 1,
      lastUserRecord: { uuid: 'u1' },
    });
  });

  it('detects a new landed user record after a snapshot', async () => {
    writeSession([userRecord('first', 'u1')]);
    const before = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    writeSession([userRecord('first', 'u1'), userRecord('second', 'u2')]);
    const after = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    expect(hasNewTranscriptUserRecord(before, after)).toBe(true);
    expect(after).toMatchObject({ userRecordCount: 2, lastUserRecord: { uuid: 'u2' } });
  });

  it('does not count assistant-only or tool-result-only appends as landed user messages', async () => {
    writeSession([userRecord('first', 'u1')]);
    const before = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    writeSession([
      userRecord('first', 'u1'),
      { type: 'assistant', message: { role: 'assistant', content: 'working' } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] } },
    ]);
    const after = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    expect(hasNewTranscriptUserRecord(before, after)).toBe(false);
    expect(after).toMatchObject({ userRecordCount: 1, lastUserRecord: { uuid: 'u1' } });
  });

  it('counts text blocks in user content arrays as landed user messages', async () => {
    writeSession([]);
    const before = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    writeSession([
      {
        type: 'user',
        uuid: 'u-array',
        message: { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      },
    ]);
    const after = await captureTranscriptUserRecordSnapshot(workspace, sessionId);

    expect(hasNewTranscriptUserRecord(before, after)).toBe(true);
    expect(after).toMatchObject({ userRecordCount: 1, lastUserRecord: { uuid: 'u-array' } });
  });
});
