/** PAN-4307 WI-3 (D-3): Overdeck-mode `isLive(nativePath)` for the Session Vault. */
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createVaultIsLive } from '../../../../../src/dashboard/server/services/vault-liveness.js';

const AGENTS_DIR = '/home/user/.overdeck/agents';
const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('createVaultIsLive (PAN-4307 WI-3)', () => {
  it('a path under agentsDir resolves the first segment as the agent id and asks agentAlive', async () => {
    const agentAlive = vi.fn().mockResolvedValue(true);
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, agentAlive });
    const nativePath = join(AGENTS_DIR, 'conv-x', 'codex-home', 'sessions', 'rollout.jsonl');
    expect(await isLive(nativePath)).toBe(true);
    expect(agentAlive).toHaveBeenCalledWith('conv-x');
  });

  it('a dead agent under agentsDir is not live', async () => {
    const agentAlive = vi.fn().mockResolvedValue(false);
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, agentAlive });
    expect(await isLive(join(AGENTS_DIR, 'conv-y', 'state.json'))).toBe(false);
  });

  it('a Claude transcript (uuid.jsonl) looks up the conversation and asks conversationHarnessAlive', async () => {
    const conversationForSessionId = vi.fn().mockReturnValue({ tmuxSession: 'conv-abc' });
    const conversationHarnessAlive = vi.fn().mockResolvedValue(true);
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, conversationForSessionId, conversationHarnessAlive });
    expect(await isLive(`/home/user/${SESSION}.jsonl`)).toBe(true);
    expect(conversationForSessionId).toHaveBeenCalledWith(SESSION);
    expect(conversationHarnessAlive).toHaveBeenCalledWith('conv-abc');
  });

  it('a Claude transcript with no matching conversation row is not live', async () => {
    const conversationForSessionId = vi.fn().mockReturnValue(null);
    const conversationHarnessAlive = vi.fn();
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, conversationForSessionId, conversationHarnessAlive });
    expect(await isLive(`/home/user/${SESSION}.jsonl`)).toBe(false);
    expect(conversationHarnessAlive).not.toHaveBeenCalled();
  });

  it('a .jsonl basename that is not a UUID is not live', async () => {
    const conversationForSessionId = vi.fn();
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, conversationForSessionId });
    expect(await isLive('/home/user/notes.jsonl')).toBe(false);
    expect(conversationForSessionId).not.toHaveBeenCalled();
  });

  it('a path that is neither under agentsDir nor a Claude transcript is not live', async () => {
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR });
    expect(await isLive('/home/user/random-file.txt')).toBe(false);
  });

  it('agentAlive throwing counts as live (never delete on uncertainty)', async () => {
    const agentAlive = vi.fn().mockRejectedValue(new Error('probe failed'));
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, agentAlive });
    expect(await isLive(join(AGENTS_DIR, 'conv-z', 'state.json'))).toBe(true);
  });

  it('conversationHarnessAlive throwing counts as live', async () => {
    const conversationForSessionId = vi.fn().mockReturnValue({ tmuxSession: 'conv-abc' });
    const conversationHarnessAlive = vi.fn().mockRejectedValue(new Error('tmux unreachable'));
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, conversationForSessionId, conversationHarnessAlive });
    expect(await isLive(`/home/user/${SESSION}.jsonl`)).toBe(true);
  });

  it('conversationForSessionId throwing counts as live', async () => {
    const conversationForSessionId = vi.fn().mockImplementation(() => {
      throw new Error('db unavailable');
    });
    const isLive = createVaultIsLive({ agentsDir: AGENTS_DIR, conversationForSessionId });
    expect(await isLive(`/home/user/${SESSION}.jsonl`)).toBe(true);
  });
});
