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

  it('defines the work role with Jidoka inspection gates and no phase labels', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/work.md'));

    expect(frontmatter).toMatchObject({
      name: 'work',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('## Per-Bead Workflow');
    expect(body).toContain("subagent_type: 'inspect'");
    expect(body).toContain("subagent_type: 'inspect-deep'");
    expect(body).toContain('bead.metadata.requiresInspection === true');
    expect(body).toContain("resolveModel('work', 'inspect')");
    expect(body).toContain("resolveModel('work', 'inspect-deep')");
    expect(body).toContain('one undifferentiated mode');
    for (const phase of ['exploration', 'implementation', 'testing', 'documentation', 'review-response']) {
      expect(body.toLowerCase()).not.toContain(phase);
    }
  });

  it('defines inspect and inspect-deep subagents for the work role Jidoka gates', () => {
    for (const name of ['inspect', 'inspect-deep']) {
      const { frontmatter, body } = splitFrontmatter(readRepoFile(`.claude/agents/${name}.md`));
      expect(frontmatter.name).toBe(name);
      expect(frontmatter.description).toEqual(expect.any(String));
      expect(frontmatter.model).toEqual(expect.any(String));
      expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
      expect(body).toContain('INSPECTION PASSED');
      expect(body).toContain('INSPECTION BLOCKED');
    }
  });

  it('defines the review role as convoy synthesis with no merge authority', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/review.md'));

    expect(frontmatter).toMatchObject({
      name: 'review',
      model: 'opus',
      permissionMode: 'plan',
      effort: 'high',
    });
    // PAN-1059: convoy reviewers run in isolated tmux sessions — synthesis
    // polls for output files instead of spawning Agent-tool subagents.
    // Agent is no longer needed in the tools list.
    expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
    expect((frontmatter.tools as string[])).not.toContain('Agent');
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('You are the synthesis agent');
    expect(body).toContain('convoy reviewers are already running');
    expect(body.toLowerCase()).toContain('poll');
    expect(body.toLowerCase()).toContain('approve');
    expect(body.toLowerCase()).toContain('request changes');
    expect(body).toContain('Review NEVER merges');
    // PAN-1059: isolated convoy sessions; synthesis reads output files.
    expect(body).toMatch(/PAN-1059/);
  });

  it('defines the test role as suite verification plus browser UAT', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/test.md'));

    expect(frontmatter).toMatchObject({
      name: 'test',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(frontmatter.mcpServers).toEqual(expect.any(Array));
    expect(body).toContain('There is no separate UAT role');
    expect(body).toContain('Playwright MCP tools');
    expect(body).toContain('isolated browser instance per session');
    expect(body).toContain(".pan/continue.json");
    expect(body).toContain('vBRIEF acceptance criteria');
    expect(body).toContain('TESTS PASSED');
    expect(body).toContain('TESTS FAILED');
  });

  it('defines the ship role as ready-to-merge preparation without merge authority', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/ship.md'));

    expect(frontmatter).toMatchObject({
      name: 'ship',
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'Edit']));
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('Ship NEVER merges');
    expect(body).toContain('ready-to-merge');
    expect(body).toContain('gh pr merge');
    expect(body).toContain('merge API `POST`');
    expect(body).toContain('git merge` into `main`');
    expect(body).toContain('npm run typecheck');
    expect(body).toContain('npm run lint');
    expect(body).toContain('npm test');
  });

  it('keeps legacy pan plan/work/review/inspect/test/uat/merge agent definitions until spawn migration deletes them', () => {
    // Check agents/ (the committed source); .claude/agents/ is gitignored and populated by pan install.
    expect(existsSync(join(process.cwd(), 'agents/pan-planning-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-work-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-review-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-inspect-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-test-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-uat-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'agents/pan-merge-agent.md'))).toBe(true);
  });
});
