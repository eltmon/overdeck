import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionFilePath } from '../paths.js';
import { captureTranscriptUserRecordSnapshot, hasNewTranscriptUserRecord, probeTranscriptSince } from '../transcript-landing.js';

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

  it('detects appended user records from the pre-delivery byte offset even when the tail count is unchanged', async () => {
    const first = JSON.stringify(userRecord('first', 'u1'));
    const second = JSON.stringify(userRecord('second', 'u2'));
    writeSession(`${first}\n`);
    const before = await captureTranscriptUserRecordSnapshot(workspace, sessionId, { tailBytes: 256 });

    const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(1024) } });
    writeSession(`${first}\n${filler}\n${second}\n`);
    const tailOnly = await captureTranscriptUserRecordSnapshot(workspace, sessionId, { tailBytes: 256 });
    const after = await captureTranscriptUserRecordSnapshot(workspace, sessionId, { fromByteOffset: before.readOffset });

    expect(tailOnly.userRecordCount).toBe(before.userRecordCount);
    expect(hasNewTranscriptUserRecord(before, tailOnly)).toBe(false);
    expect(hasNewTranscriptUserRecord(before, after)).toBe(true);
    expect(after).toMatchObject({ userRecordCount: 1, lastUserRecord: { uuid: 'u2' } });
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

describe('probeTranscriptSince (PAN-1635 / PAN-1769 eaten-message detection)', () => {
  it('matches the delivered message in a landed user record', async () => {
    writeSession([userRecord('Ok please fix it immediately here on main.', 'u1')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'Ok  please fix it\nimmediately here on main.'),
    ).resolves.toEqual({ matchedUserRecord: true, compactBoundaryCount: 0 });
  });

  it('only scans records past the given byte offset', async () => {
    const sessionFile = writeSession([userRecord('older message', 'u1')]);
    const offset = statSync(sessionFile).size;
    writeSession([userRecord('older message', 'u1'), userRecord('unrelated turn', 'u2')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, offset, 'older message'),
    ).resolves.toEqual({ matchedUserRecord: false, compactBoundaryCount: 0 });
  });

  it('counts compact boundaries and refuses to treat compaction meta user records as a landing', async () => {
    writeSession([
      { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', timestamp: '2026-06-11T06:46:25.355Z' },
      userRecord('This session is being continued from a previous conversation. The user said: "deploy the fix now"', 'u-summary'),
      userRecord('<command-name>/compact</command-name>', 'u-cmd'),
      userRecord('<local-command-stdout>Compacted</local-command-stdout>', 'u-stdout'),
      userRecord('Caveat: The messages below were generated by the user while running local commands.', 'u-caveat'),
    ]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'deploy the fix now'),
    ).resolves.toEqual({ matchedUserRecord: false, compactBoundaryCount: 1 });
  });

  it('returns safe defaults for a missing session file', async () => {
    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'anything'),
    ).resolves.toEqual({ matchedUserRecord: false, compactBoundaryCount: 0 });
  });
});
