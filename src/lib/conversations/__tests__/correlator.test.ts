import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildCorrelationMapSync } from '../correlator.js';
import { sessionFilePath } from '../../paths.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('buildCorrelationMapSync', () => {
  it('keeps Claude path correlation unchanged', () => {
    seedConversation('conv-claude', 'conv-claude', '/home/user/Projects/app', 'PAN-457', 'claude-sess');
    const path = sessionFilePath('/home/user/Projects/app', 'claude-sess');

    const map = buildCorrelationMapSync([path]);

    expect(map.get(path)).toMatchObject({
      overdeckManaged: true,
      panIssueId: 'PAN-457',
      panAgentId: 'conv-claude',
    });
  });

  it('correlates non-Claude paths by parsed session locator', () => {
    seedConversation('conv-omp', 'conv-omp', '/home/user/Projects/app', 'PAN-2224', 'omp-session-1', 'ohmypi');
    const path = '/tmp/20260702_omp-session-1.jsonl';

    const map = buildCorrelationMapSync([path], new Map([[path, 'omp-session-1']]));

    expect(map.get(path)).toMatchObject({
      overdeckManaged: true,
      panIssueId: 'PAN-2224',
      panAgentId: 'conv-omp',
    });
  });
});

function seedConversation(
  id: string,
  name: string,
  cwd: string,
  issueId: string,
  locator: string,
  harness = 'claude-code',
): void {
  const db = odb.raw();
  db.prepare(
    `INSERT INTO conversations (id, name, tmux_session, status, cwd, issue_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, name, 'active', cwd, issueId, new Date('2026-07-02T00:00:00.000Z').toISOString());
  db.prepare(
    `INSERT INTO conversation_files (conversation_id, harness, locator, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, harness, locator, Date.parse('2026-07-02T00:00:00.000Z'));
}
