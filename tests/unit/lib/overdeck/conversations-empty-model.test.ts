import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  createConversation,
  getConversationByName,
  reactivateConversationForSpawn,
} from '../../../../src/lib/overdeck/conversations.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 15_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('conversation model metadata persistence', () => {
  it('persists empty and whitespace-only model metadata as null', () => {
    createConversation({
      name: 'empty-model',
      tmuxSession: 'tmux-empty-model',
      cwd: '/tmp',
      model: '',
      effort: '',
    });
    createConversation({
      name: 'whitespace-model',
      tmuxSession: 'tmux-whitespace-model',
      cwd: '/tmp',
      model: '   ',
    });

    expect(getConversationByName('empty-model')).toMatchObject({
      model: null,
      effort: null,
    });
    expect(getConversationByName('whitespace-model')?.model).toBeNull();
  });

  it('preserves real model and effort values', () => {
    createConversation({
      name: 'real-model',
      tmuxSession: 'tmux-real-model',
      cwd: '/tmp',
      model: 'k3',
      effort: 'high',
    });

    expect(getConversationByName('real-model')).toMatchObject({
      model: 'k3',
      effort: 'high',
    });
  });

  it('persists an empty model as null when reactivating for spawn', () => {
    createConversation({
      name: 'reactivated-model',
      tmuxSession: 'tmux-reactivated-model',
      cwd: '/tmp',
      model: 'k3',
    });

    reactivateConversationForSpawn({
      name: 'reactivated-model',
      tmuxSession: 'tmux-reactivated-model',
      cwd: '/tmp',
      model: '',
    });

    expect(getConversationByName('reactivated-model')?.model).toBeNull();
  });
});
