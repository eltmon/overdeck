/** PAN-4651 WI-1 (D-4651-1): the provenance column and its two doors. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOverdeckDatabase, getOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';
import { conversationStartedBy, markConversationStartedBy } from '../../../../src/lib/overdeck/conversation-provenance.js';
import { createConversation } from '../../../../src/lib/overdeck/conversations.js';

const originalHome = process.env.HOME;
const originalOverdeckHome = process.env.OVERDECK_HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4651-provenance-'));
  process.env.HOME = home;
  process.env.OVERDECK_HOME = home;
  closeOverdeckDatabase();
});

afterEach(() => {
  closeOverdeckDatabase();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  rmSync(home, { recursive: true, force: true });
});

describe('conversation provenance (D-4651-1)', () => {
  it('ac4: a fresh overdeck.db has started_by_environment_id on conversations', () => {
    const columns = getOverdeckDatabase()
      .prepare('PRAGMA table_info(conversations)')
      .all<{ name: string }>()
      .map((column) => column.name);
    expect(columns).toContain('started_by_environment_id');
  });

  it('ac4: markConversationStartedBy then conversationStartedBy returns the stored environment id', () => {
    createConversation({ name: 'conv-a', tmuxSession: 'conv-a', cwd: home, harness: 'claude-code' });
    expect(conversationStartedBy('conv-a')).toBeNull();
    markConversationStartedBy('conv-a', 'env-laptop');
    expect(conversationStartedBy('conv-a')).toBe('env-laptop');
  });

  it('answers null for an unknown conversation and ignores a mark on one', () => {
    markConversationStartedBy('conv-missing', 'env-laptop');
    expect(conversationStartedBy('conv-missing')).toBeNull();
  });
});
