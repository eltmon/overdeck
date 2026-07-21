import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prompt = readFileSync(
  join(process.cwd(), 'src/lib/cloister/prompts/work.md'),
  'utf-8',
);

describe('work prompt git operation rules', () => {
  it('uses pan sync-main instead of instructing agents to rebase on restart', () => {
    expect(prompt).toContain('pan sync-main {{ISSUE_ID}}');
    expect(prompt).not.toContain('git rebase origin/main');
  });

  it('lists permitted and forbidden git operations in the git-rules table', () => {
    const tableStart = prompt.indexOf('| Permitted git operations | Forbidden git operations |');
    expect(tableStart).toBeGreaterThan(-1);

    const tableEnd = prompt.indexOf('\n\n', tableStart);
    const table = prompt.slice(tableStart, tableEnd);

    for (const permitted of ['git add', 'git commit', 'git status', 'git fetch', 'git push']) {
      expect(table).toContain(permitted);
    }
    for (const forbidden of ['git rebase', 'git reset --hard', 'git stash']) {
      expect(table).toContain(forbidden);
    }
  });
});
