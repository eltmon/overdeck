import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REVIEW_FLAVORS = ['security', 'correctness', 'performance', 'requirements', 'synthesis'] as const;

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

describe('code review Claude Code agent definitions', () => {
  for (const flavor of REVIEW_FLAVORS) {
    it(`defines code-review-${flavor} with valid frontmatter`, () => {
      const agent = splitFrontmatter(readRepoFile(`.claude/agents/code-review-${flavor}.md`));

      expect(agent.frontmatter.name).toBe(`code-review-${flavor}`);
      expect(agent.frontmatter.description).toEqual(expect.any(String));
      expect(agent.frontmatter.model).toEqual(expect.any(String));
      expect(agent.frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Write']));
      expect(agent.body.trim().length).toBeGreaterThan(100);
    });
  }

  it('does not keep legacy source prompt-template files', () => {
    for (const flavor of REVIEW_FLAVORS) {
      expect(existsSync(join(process.cwd(), `src/lib/cloister/prompts/review/code-review-${flavor}.prompt-template.md`))).toBe(false);
    }
  });
});
