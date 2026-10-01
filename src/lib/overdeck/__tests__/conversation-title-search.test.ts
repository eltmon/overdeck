import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when infra.js loads, so set it before the first
// dynamic import of the overdeck modules.
const TEST_HOME = join(tmpdir(), `title-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { getOverdeckDatabase, closeOverdeckDatabase } = await import('../infra.js');
const { createConversation } = await import('../conversations.js');
const { titleMatchesQuery, searchConversationTitles } = await import('../conversation-title-search.js');

function setTitleAndArchive(name: string, title: string, archivedAtMs: number | null): void {
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET title = ?, archived_at = ? WHERE name = ?')
    .run(title, archivedAtMs, name);
}

beforeAll(() => {
  createConversation({ name: 'portfolio-convo', tmuxSession: 'conv-portfolio-convo', cwd: TEST_HOME });
  setTitleAndArchive('portfolio-convo', 'Personal portfolio deployment to GitHub', null);

  createConversation({ name: 'archived-convo', tmuxSession: 'conv-archived-convo', cwd: TEST_HOME });
  setTitleAndArchive('archived-convo', 'Archived eltmon retrospective', Date.now());

  createConversation({ name: 'agent-abc123', tmuxSession: 'conv-agent-abc123', cwd: TEST_HOME });
  setTitleAndArchive('agent-abc123', 'eltmon subagent title', null);
  createConversation({ name: 'planning-abc123', tmuxSession: 'conv-planning-abc123', cwd: TEST_HOME });
  setTitleAndArchive('planning-abc123', 'eltmon planning title', null);
  createConversation({ name: 'specialist-abc123', tmuxSession: 'conv-specialist-abc123', cwd: TEST_HOME });
  setTitleAndArchive('specialist-abc123', 'eltmon specialist title', null);

  createConversation({ name: 'errors-convo', tmuxSession: 'conv-errors-convo', cwd: TEST_HOME });
  setTitleAndArchive('errors-convo', '500 errors dashboard', null);

  createConversation({ name: 'older-eltmon', tmuxSession: 'conv-older-eltmon', cwd: TEST_HOME });
  setTitleAndArchive('older-eltmon', 'eltmon-site redesign', null);
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET last_attached_at = ? WHERE name = ?')
    .run(1000, 'older-eltmon');

  createConversation({ name: 'newer-eltmon', tmuxSession: 'conv-newer-eltmon', cwd: TEST_HOME });
  setTitleAndArchive('newer-eltmon', 'eltmon status page', null);
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET last_attached_at = ? WHERE name = ?')
    .run(2000, 'newer-eltmon');
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('titleMatchesQuery', () => {
  it('matches when every term prefixes a title word', () => {
    expect(titleMatchesQuery('Personal portfolio deployment to GitHub', 'portfolio')).toBe(true);
    expect(titleMatchesQuery('Personal portfolio deployment to GitHub', 'Personal portfolio')).toBe(true);
    expect(titleMatchesQuery('Personal portfolio deployment to GitHub', 'deploy')).toBe(true);
    expect(titleMatchesQuery('Personal portfolio deployment to GitHub', 'personal site')).toBe(false);
    expect(titleMatchesQuery('eltmon-site redesign', 'eltmon')).toBe(true);
    expect(titleMatchesQuery('x', '')).toBe(false);
  });
});

describe('searchConversationTitles', () => {
  it('returns an archived titled conversation with archived: true', () => {
    const results = searchConversationTitles('retrospective');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ conversationId: 'archived-convo', archived: true });
  });

  it('excludes agent-, planning-, and specialist- rows', () => {
    const results = searchConversationTitles('eltmon');
    const ids = results.map((row) => row.conversationId);
    expect(ids).not.toContain('agent-abc123');
    expect(ids).not.toContain('planning-abc123');
    expect(ids).not.toContain('specialist-abc123');
  });

  it('does not let a literal `_` in the query act as a single-character SQL wildcard', () => {
    // Unescaped, LIKE '%50_%' would treat '_' as "any one character" and match
    // "500 errors" at the SQL layer; escaped, only a literal underscore matches.
    const results = searchConversationTitles('50_');
    expect(results.map((row) => row.conversationId)).not.toContain('errors-convo');
  });

  it('returns results newest activity first', () => {
    const results = searchConversationTitles('eltmon');
    const ids = results.map((row) => row.conversationId);
    expect(ids.indexOf('newer-eltmon')).toBeLessThan(ids.indexOf('older-eltmon'));
  });

  it('finds a conversation by a topic word not present in its transcript', () => {
    const results = searchConversationTitles('portfolio');
    expect(results.map((row) => row.conversationId)).toEqual(['portfolio-convo']);
  });
});
