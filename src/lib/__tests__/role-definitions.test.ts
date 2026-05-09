import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('missing frontmatter');
  return {
    frontmatter: parse(match[1]!) as Record<string, unknown>,
    body: match[2]!,
  };
}

describe('role definitions', () => {
  it('defines the plan role with planning workflow instructions', () => {
    const rolePath = 'roles/plan.md';
    expect(existsSync(join(process.cwd(), rolePath))).toBe(true);

    const { frontmatter, body } = splitFrontmatter(readRepoFile(rolePath));

    expect(frontmatter).toMatchObject({
      name: 'plan',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.description).toEqual(expect.any(String));
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('Read the issue, the linked PRD');
    expect(body).toContain('AskUserQuestion');
    expect(body).toContain('vBRIEF plan');
    expect(body).toContain('Beads');
    expect(body).toContain('pan plan-finalize <ISSUE-ID>');
    expect(body).toContain('Stop after planning is complete');
  });

  it('keeps the legacy pan-planning-agent definition until spawn migration deletes it', () => {
    expect(existsSync(join(process.cwd(), '.claude/agents/pan-planning-agent.md'))).toBe(true);
  });
});
