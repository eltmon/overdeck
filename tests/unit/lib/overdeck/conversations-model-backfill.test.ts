import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  backfillConversationModel,
  createConversation,
  getConversationByName,
} from '../../../../src/lib/overdeck/conversations.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 15_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('backfillConversationModel', () => {
  it('repairs an empty-string model row', () => {
    createConversation({
      name: 'empty-model-backfill',
      tmuxSession: 'tmux-empty-model-backfill',
      cwd: '/tmp',
      model: 'k3',
    });
    odb.raw().prepare(`UPDATE conversations SET model = '' WHERE name = ?`).run('empty-model-backfill');

    backfillConversationModel('empty-model-backfill', 'claude-opus-5');

    expect(getConversationByName('empty-model-backfill')?.model).toBe('claude-opus-5');
  });

  it('preserves an existing non-empty model', () => {
    createConversation({
      name: 'known-model-backfill',
      tmuxSession: 'tmux-known-model-backfill',
      cwd: '/tmp',
      model: 'k3',
    });

    backfillConversationModel('known-model-backfill', 'claude-opus-5');

    expect(getConversationByName('known-model-backfill')?.model).toBe('k3');
  });
});
