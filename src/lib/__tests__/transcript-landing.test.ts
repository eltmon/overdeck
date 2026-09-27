import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionFilePath } from '../runtimes/storage/claude-code.js';
import {
  captureSidechainOffsets,
  captureTranscriptUserRecordSnapshot,
  extractSidechainHumanText,
  probeSidechainsSince,
  probeTranscriptSince,
  readSidechainHumanInputs,
} from '../transcript-landing.js';

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

function queueEnqueueRecord(content: string): unknown {
  return { type: 'queue-operation', operation: 'enqueue', content, timestamp: '2026-06-10T00:00:05.000Z' };
}

function queuedCommandAttachmentRecord(prompt: string): unknown {
  return {
    type: 'attachment',
    attachment: { type: 'queued_command', prompt },
    timestamp: '2026-06-10T00:00:05.000Z',
  };
}

function sidechainRecord(text: string, uuid: string, origin: string): unknown {
  return {
    type: 'user',
    isSidechain: true,
    uuid,
    timestamp: `2026-06-10T00:00:0${uuid.slice(-1)}.000Z`,
    origin: { kind: origin },
    message: { role: 'user', content: text },
  };
}

function writeSubagentTranscript(agentId: string, lines: unknown[], description?: string): string {
  const subagentsDir = join(sessionFilePath(workspace, sessionId).replace(/\.jsonl$/, ''), 'subagents');
  mkdirSync(subagentsDir, { recursive: true });
  const transcriptPath = join(subagentsDir, `agent-${agentId}.jsonl`);
  writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  if (description !== undefined) {
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.meta.json`),
      JSON.stringify({ agentType: 'general-purpose', description, toolUseId: `tool-${agentId}`, spawnDepth: 1 }),
      'utf8',
    );
  }
  return transcriptPath;
}

function appendToSubagentTranscript(agentId: string, line: unknown): void {
  const subagentsDir = join(sessionFilePath(workspace, sessionId).replace(/\.jsonl$/, ''), 'subagents');
  appendFileSync(join(subagentsDir, `agent-${agentId}.jsonl`), `${JSON.stringify(line)}\n`, 'utf8');
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




});

describe('probeTranscriptSince (PAN-1635 / PAN-1769 eaten-message detection)', () => {
  it('matches the delivered message in a landed user record', async () => {
    writeSession([userRecord('Ok please fix it immediately here on main.', 'u1')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'Ok  please fix it\nimmediately here on main.'),
    ).resolves.toEqual({ matchedUserRecord: true, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
  });

  it('only scans records past the given byte offset', async () => {
    const sessionFile = writeSession([userRecord('older message', 'u1')]);
    const offset = statSync(sessionFile).size;
    writeSession([userRecord('older message', 'u1'), userRecord('unrelated turn', 'u2')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, offset, 'older message'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
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
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 1 });
  });

  it('counts a real assistant response but ignores synthetic compaction bookkeeping', async () => {
    writeSession([
      { type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: 'No response requested.' } },
      { type: 'assistant', message: { role: 'assistant', model: 'gpt-5.6-sol', content: 'Continuing now.' } },
    ]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'continue'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 1, compactBoundaryCount: 0 });
  });

  it('returns safe defaults for a missing session file', async () => {
    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'anything'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
  });

  it('matches a queue-operation enqueue record carrying the message (PAN-4247 AC1)', async () => {
    writeSession([queueEnqueueRecord('Please redeploy the fix now.')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'Please redeploy the fix now.'),
    ).resolves.toEqual({ matchedUserRecord: true, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
  });

  it('matches a queued_command attachment record carrying the message (PAN-4247 AC1)', async () => {
    writeSession([queuedCommandAttachmentRecord('Please redeploy the fix now.')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'Please redeploy the fix now.'),
    ).resolves.toEqual({ matchedUserRecord: true, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
  });

  it('never matches queued text that is itself a task-notification wake', async () => {
    writeSession([queueEnqueueRecord('<task-notification><tool-use-id>abc</tool-use-id></task-notification>')]);

    await expect(
      probeTranscriptSince(workspace, sessionId, 0, '<task-notification>'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 });
  });

  it('does not count an assistant turn that follows a task-notification wake, but does count one after an ordinary user record (PAN-4247 AC2)', async () => {
    writeSession([
      userRecord('<task-notification><tool-use-id>abc</tool-use-id></task-notification>', 'u1'),
      { type: 'assistant', message: { role: 'assistant', model: 'gpt-5.6-sol', content: 'Noted.' } },
    ]);
    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'irrelevant'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 0, compactBoundaryCount: 0 });

    writeSession([
      userRecord('go ahead', 'u1'),
      { type: 'assistant', message: { role: 'assistant', model: 'gpt-5.6-sol', content: 'Noted.' } },
    ]);
    await expect(
      probeTranscriptSince(workspace, sessionId, 0, 'irrelevant'),
    ).resolves.toEqual({ matchedUserRecord: false, realAssistantTurnCount: 1, compactBoundaryCount: 0 });
  });
});

describe('extractSidechainHumanText (PAN-4247 AC3)', () => {
  it('strips the Claude Code sidechain wrapper down to the operator text', () => {
    const wrapped = 'The user sent a new message while you were working:\n'
      + 'please pause and check the logs'
      + '\n\nThis is how Claude Code surfaces a message sent mid-turn.';

    expect(extractSidechainHumanText(wrapped)).toBe('please pause and check the logs');
  });

  it('returns the raw trimmed text when the wrapper is absent', () => {
    expect(extractSidechainHumanText('  plain operator text  ')).toBe('plain operator text');
  });
});

describe('probeSidechainsSince (PAN-4247 AC4)', () => {
  it('finds a human-origin sidechain record written after the captured offset, and returns its description', async () => {
    const agentId = 'agent-1';
    writeSubagentTranscript(agentId, [], 'Investigate flaky test');
    const offsets = await captureSidechainOffsets(sessionFilePath(workspace, sessionId));

    appendToSubagentTranscript(agentId, sidechainRecord('please pause and check the logs', 'u1', 'human'));

    await expect(
      probeSidechainsSince(sessionFilePath(workspace, sessionId), offsets, 'please pause and check the logs'),
    ).resolves.toEqual({ agentId, description: 'Investigate flaky test' });
  });

  it('falls back to the agent id when no meta.json description is present', async () => {
    const agentId = 'agent-2';
    const offsets = await captureSidechainOffsets(sessionFilePath(workspace, sessionId));
    writeSubagentTranscript(agentId, [sidechainRecord('please pause and check the logs', 'u1', 'human')]);

    await expect(
      probeSidechainsSince(sessionFilePath(workspace, sessionId), offsets, 'please pause and check the logs'),
    ).resolves.toEqual({ agentId, description: agentId });
  });

  it('returns null for coordinator, peer, and task-notification origins', async () => {
    const agentId = 'agent-3';
    writeSubagentTranscript(agentId, [
      sidechainRecord('please pause and check the logs', 'u1', 'coordinator'),
      sidechainRecord('please pause and check the logs', 'u2', 'peer'),
      sidechainRecord('please pause and check the logs', 'u3', 'task-notification'),
    ]);
    const offsets = new Map<string, number>();

    await expect(
      probeSidechainsSince(sessionFilePath(workspace, sessionId), offsets, 'please pause and check the logs'),
    ).resolves.toBeNull();
  });

  it('returns null for a human record written before the captured offset', async () => {
    const agentId = 'agent-4';
    writeSubagentTranscript(agentId, [sidechainRecord('please pause and check the logs', 'u1', 'human')]);
    const offsets = await captureSidechainOffsets(sessionFilePath(workspace, sessionId));

    await expect(
      probeSidechainsSince(sessionFilePath(workspace, sessionId), offsets, 'please pause and check the logs'),
    ).resolves.toBeNull();
  });

  it('returns null when the subagents directory does not exist', async () => {
    await expect(
      probeSidechainsSince(sessionFilePath(workspace, sessionId), new Map(), 'anything'),
    ).resolves.toBeNull();
  });
});

describe('readSidechainHumanInputs', () => {
  it('reads only complete lines appended since fromByteOffset', async () => {
    const transcriptPath = writeSubagentTranscript('agent-5', [
      sidechainRecord('first message', 'u1', 'human'),
    ]);
    const offset = statSync(transcriptPath).size;

    writeFileSync(
      transcriptPath,
      `${JSON.stringify(sidechainRecord('first message', 'u1', 'human'))}\n${JSON.stringify(sidechainRecord('second message', 'u2', 'human'))}\n`,
      'utf8',
    );

    const result = await readSidechainHumanInputs(transcriptPath, offset);
    expect(result.inputs).toEqual([{ id: 'u2', text: 'second message', createdAt: '2026-06-10T00:00:02.000Z' }]);
    expect(result.readOffset).toBe(statSync(transcriptPath).size);
  });

  it('returns safe defaults for a missing file', async () => {
    await expect(readSidechainHumanInputs('/nonexistent/agent-x.jsonl', 0)).resolves.toEqual({
      inputs: [],
      readOffset: 0,
    });
  });
});
