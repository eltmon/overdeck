/** PAN-4185: bare conversations persist their context opt-outs on the row. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { createConversation, getConversationByName } from '../../../../src/lib/overdeck/conversations.js';
import {
  conversationContextEnvExports,
  conversationLaunchContext,
} from '../../../../src/lib/overdeck/conversation-launch-context.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 15_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('conversation context opt-outs persistence (PAN-4185)', () => {
  it('round-trips bareContext and skipClaudeMd through the conversation row', () => {
    createConversation({ name: 'bare', tmuxSession: 'conv-bare', cwd: '/tmp', bareContext: true, skipClaudeMd: true });
    const conv = getConversationByName('bare');
    expect(conv).toMatchObject({ bareContext: true, skipClaudeMd: true });
    // Resume, restart and fork all relaunch from the row.
    expect(conversationLaunchContext(conv!)).toEqual({ bareContext: true, skipClaudeMd: true });
  });

  it('defaults both opt-outs off', () => {
    createConversation({ name: 'full', tmuxSession: 'conv-full', cwd: '/tmp' });
    expect(getConversationByName('full')).toMatchObject({ bareContext: false, skipClaudeMd: false });
  });
});

describe('conversationContextEnvExports (PAN-4185)', () => {
  it('exports nothing for a normal conversation', () => {
    expect(conversationContextEnvExports({}, 'claude-code')).toEqual([]);
  });

  it('exports the bare flag the injecting hooks check', () => {
    expect(conversationContextEnvExports({ bareContext: true }, 'claude-code')).toEqual(['export OVERDECK_BARE_CONTEXT=1']);
  });

  it('turns off native CLAUDE.md and auto memory for Claude Code only', () => {
    expect(conversationContextEnvExports({ skipClaudeMd: true }, 'claude-code')).toEqual([
      'export CLAUDE_CODE_DISABLE_CLAUDE_MDS=1',
      'export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1',
    ]);
    expect(conversationContextEnvExports({ skipClaudeMd: true }, 'codex')).toEqual([]);
  });
});
