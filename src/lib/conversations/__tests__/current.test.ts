import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// PANOPTICON_HOME must be set before the DB modules are imported so they use a
// temp database. The env-var path of resolveCurrentConversation is the
// deterministic core (it never shells out to tmux), so these tests exercise it
// without a real tmux server.
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';
import { createConversation } from '../../overdeck/conversations.js';

let odb: OverdeckTestDb;
const originalAgentId = process.env.PANOPTICON_AGENT_ID;
const originalTmux = process.env.TMUX;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  delete process.env.PANOPTICON_AGENT_ID;
  // Ensure the tmux fallback is never taken in these env-var-focused tests.
  delete process.env.TMUX;
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  if (originalAgentId === undefined) delete process.env.PANOPTICON_AGENT_ID;
  else process.env.PANOPTICON_AGENT_ID = originalAgentId;
  if (originalTmux === undefined) delete process.env.TMUX;
  else process.env.TMUX = originalTmux;
});

describe('resolveCurrentConversation (PAN-1520)', () => {
  it('returns null when PANOPTICON_AGENT_ID is unset and not in tmux', async () => {
    const { resolveCurrentConversation } = await import('../current.js');
    expect(await resolveCurrentConversation()).toBeNull();
  });

  it('resolves the conversation named by PANOPTICON_AGENT_ID', async () => {
    createConversation({ name: 'mine', tmuxSession: 'conv-mine', cwd: '/cwd' });
    process.env.PANOPTICON_AGENT_ID = 'conv-mine';

    const { resolveCurrentConversation } = await import('../current.js');
    expect((await resolveCurrentConversation())?.name).toBe('mine');
  });

  it('returns null when the env var points at no known conversation', async () => {
    process.env.PANOPTICON_AGENT_ID = 'conv-ghost';
    const { resolveCurrentConversation } = await import('../current.js');
    expect(await resolveCurrentConversation()).toBeNull();
  });

  it('currentTmuxSession prefers the env var over tmux', async () => {
    process.env.PANOPTICON_AGENT_ID = 'conv-from-env';
    const { currentTmuxSession } = await import('../current.js');
    expect(await currentTmuxSession()).toBe('conv-from-env');
  });
});
