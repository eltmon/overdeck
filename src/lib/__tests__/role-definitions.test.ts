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
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
    expect(frontmatter.description).toEqual(expect.any(String));
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('Read the issue and the PRD draft');
    expect(body).toContain('.pan/drafts/');
    expect(body).toContain('AskUserQuestion');
    expect(body).toContain('vBRIEF plan');
    expect(body).toContain('Beads');
    expect(body).toContain('pan plan-finalize <ISSUE-ID>');
    expect(body).toContain('Stop after planning is complete');
    // Status-as-field model — files do not move between directories
    expect(body).toContain('Files never move between directories');
    // Output instructions must point at the canonical .pan/specs/ path, not legacy directories
    expect(body).toMatch(/Promote.*\.pan\/specs\/|\.pan\/specs\/.*proposed/i);
  });

  it('defines the work role with Jidoka inspection gates and no phase labels', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/work.md'));

    expect(frontmatter).toMatchObject({
      name: 'work',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('## Per-Bead Workflow');
    expect(body).toContain('metadata.requiresInspection === true');
    expect(body).toContain('inspectionDepth: "deep"');
    expect(body).toContain('pan inspect <ISSUE-ID> --bead <bead-id>');
    expect(body).toContain('pan inspect --deep');
    expect(body).toContain("resolveModel('work', 'inspect')");
    expect(body).toContain("resolveModel('work', 'inspect-deep')");
    expect(body).toContain('one undifferentiated mode');
    expect(body).toContain('Never approve, deny, dismiss, or answer permission prompts');
    expect(body).toContain('tmux send-keys');
    for (const phase of ['exploration', 'implementation', 'testing', 'documentation', 'review-response']) {
      expect(body.toLowerCase()).not.toContain(phase);
    }
  });

  it('defines inspect and inspect-deep as work sub-roles without ambient Claude subagents', () => {
    expect(existsSync(join(process.cwd(), '.claude/agents/inspect.md'))).toBe(false);
    expect(existsSync(join(process.cwd(), '.claude/agents/inspect-deep.md'))).toBe(false);

    const body = readRepoFile('src/lib/cloister/prompts/inspect-agent.md');
    expect(body).toContain('INSPECTION PASSED');
    expect(body).toContain('INSPECTION BLOCKED');

    const inspectAgentSource = readRepoFile('src/lib/cloister/inspect-agent.ts');
    expect(inspectAgentSource).toContain("resolveModel('work', subRole, config)");
    expect(inspectAgentSource).not.toContain('--agent .claude/agents/');
  });

  it('defines the review role as convoy synthesis with no merge authority', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/review.md'));

    expect(frontmatter).toMatchObject({
      name: 'review',
      permissionMode: 'plan',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
    // Convoy reviewers run in isolated tmux sessions — synthesis polls for
    // output files instead of spawning Agent-tool subagents, so Agent is
    // intentionally absent from the tools list.
    expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
    expect((frontmatter.tools as string[])).not.toContain('Agent');
    expect(frontmatter.hooks).toEqual(expect.any(Object));
    expect(body).toContain('You are the review synthesis agent');
    expect(body).toContain('pan review spawn-reviewer');
    expect(body.toLowerCase()).toContain('poll');
    expect(body.toLowerCase()).toContain('approve');
    expect(body.toLowerCase()).toContain('changes requested');
    expect(body).toContain('Review never merges');
  });

  it('defines the test role as suite verification plus browser UAT', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/test.md'));

    expect(frontmatter).toMatchObject({
      name: 'test',
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
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
      permissionMode: 'bypassPermissions',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
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

  // Convoy sub-role prompt templates are harness-agnostic — no YAML frontmatter,
  // no Claude `--agent` flag. The orchestrator reads them from packageRoot/roles/
  // and inlines the body into each convoy spawn message, so the same prompt
  // drives Claude Code, Pi, and any future harness.
  it.each(['security', 'correctness', 'performance', 'requirements'])(
    'defines the review-%s sub-role prompt template with no frontmatter',
    (subRole) => {
      const path = `roles/review-${subRole}.md`;
      expect(existsSync(join(process.cwd(), path))).toBe(true);

      const content = readRepoFile(path);
      expect(content.startsWith('---')).toBe(false);
      expect(content).toMatch(/Context manifest/i);
      expect(content).toMatch(/Write exactly one final report to the output file/i);
      expect(content).not.toContain('.claude/reviews/');
    },
  );
});
