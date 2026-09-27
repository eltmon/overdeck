/**
 * PAN-4268: the conversation read model's inputTarget. The pane is read only
 * for a live claude-code conversation whose session has a subagents/ directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readConversationInputTarget } from '../conversation-input-target.js';

const SUBAGENT_SELECTED = readFileSync(
  new URL('../../agents/__fixtures__/claude-code-2.1.280/subagent-selected.txt', import.meta.url),
  'utf8',
);
const conv = { tmuxSession: 'conv-x', harness: 'claude-code' };

describe('readConversationInputTarget', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('returns undefined without reading the pane for a dead session', async () => {
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    const hasSubagentsDir = vi.fn(async () => true);
    await expect(readConversationInputTarget(conv, false, '/s/session.jsonl', { read, hasSubagentsDir })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns undefined without reading the pane when there is no subagents/ directory', async () => {
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    await expect(readConversationInputTarget(conv, true, '/s/session.jsonl', { read, hasSubagentsDir: async () => false })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns undefined without reading the pane for a codex conversation', async () => {
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    const hasSubagentsDir = vi.fn(async () => true);
    await expect(readConversationInputTarget({ tmuxSession: 'conv-x', harness: 'codex' }, true, '/s/rollout.jsonl', { read, hasSubagentsDir })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(hasSubagentsDir).not.toHaveBeenCalled();
  });

  it('returns undefined without a session file', async () => {
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    await expect(readConversationInputTarget(conv, true, null, { read })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the selector for a live claude-code conversation with a subagents/ directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pan-4268-input-target-'));
    const sessionFile = join(dir, 'session-1.jsonl');
    mkdirSync(join(dir, 'session-1', 'subagents'), { recursive: true });
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    await expect(readConversationInputTarget(conv, true, sessionFile, { read })).resolves.toEqual({ subagent: 'Counter run' });
    expect(read).toHaveBeenCalledWith('conv-x');
  });

  it('defaults a missing harness to claude-code', async () => {
    const read = vi.fn(async () => SUBAGENT_SELECTED);
    await expect(readConversationInputTarget({ tmuxSession: 'conv-x', harness: null }, true, '/s/session.jsonl', { read, hasSubagentsDir: async () => true })).resolves.toEqual({ subagent: 'Counter run' });
  });

  it('returns unknown when the pane read throws', async () => {
    const read = vi.fn(async () => { throw new Error('herdr holds no pane'); });
    await expect(readConversationInputTarget(conv, true, '/s/session.jsonl', { read, hasSubagentsDir: async () => true })).resolves.toBe('unknown');
  });
});
