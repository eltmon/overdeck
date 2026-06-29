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
      permissionMode: 'default',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
    expect(frontmatter.description).toEqual(expect.any(String));
    expect(body).toContain('Read the issue and the PRD draft');
    expect(body).toContain('.pan/drafts/');
    expect(body).toContain('AskUserQuestion');
    expect(body).toContain('vBRIEF plan');
    expect(body).toContain('Beads');
    expect(body).toContain('pan plan finalize');
    expect(body).not.toContain('pan plan finalize <ISSUE-ID>');
    expect(body).toContain('Stop after `pan plan finalize` returns');
    // Status-as-field model — files do not move between directories
    expect(body).toContain('Files never move between directories');
    // Output instructions must point at the canonical .pan/specs/ path, not legacy directories
    expect(body).toMatch(/Promote.*\.pan\/specs\/|\.pan\/specs\/.*proposed/i);
  });

  it('defines the work role with Jidoka inspection gates and no phase labels', () => {
    const { frontmatter, body } = splitFrontmatter(readRepoFile('roles/work.md'));

    expect(frontmatter).toMatchObject({
      name: 'work',
      permissionMode: 'default',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
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

  it.each(['flywheel', 'work', 'plan'] as const)(
    'wires gh issue trailer hook before RTK Bash filtering for %s role',
    (role) => {
      const { frontmatter } = splitFrontmatter(readRepoFile(`roles/${role}.md`));
      const hooks = frontmatter.hooks as {
        PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>;
      };
      const bashMatcher = hooks.PreToolUse.find((entry) => entry.matcher === 'Bash');

      // PAN-1084: work agents get an extra guard that blocks tmux send-keys to
      // other agents' sessions; it must run before the Bash rewriter/filter.
      const expected =
        role === 'work'
          ? [
              '$HOME/.overdeck/bin/tmux-send-keys-guard',
              '$HOME/.overdeck/bin/gh-issue-trailer-hook',
              '$HOME/.overdeck/bin/rtk-bash-filter',
            ]
          : [
              '$HOME/.overdeck/bin/gh-issue-trailer-hook',
              '$HOME/.overdeck/bin/rtk-bash-filter',
            ];

      expect(bashMatcher?.hooks.map((hook) => hook.command)).toEqual(expected);
    },
  );

  it('ships a workflow-injected inspect prompt with the Jidoka sentinels', () => {
    // Sub-roles work.inspect and work.inspect-deep both inline this single
    // harness-agnostic prompt (no .claude/agents/*.md ambient subagent).
    const body = readRepoFile('src/lib/cloister/prompts/inspect-agent.md');
    expect(body).toContain('INSPECTION PASSED');
    expect(body).toContain('INSPECTION BLOCKED');
    expect(body).toContain('{{issueId}}');
    expect(body).toContain('{{beadId}}');

    const dispatcher = readRepoFile('src/lib/cloister/inspect-agent.ts');
    expect(dispatcher).toContain("baseCommand: 'claude'");
    expect(dispatcher).toContain('permissionFlags: getClaudePermissionFlagsSync()');
    expect(dispatcher).not.toContain('--agent .claude/agents/${subRole}.md');
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
      permissionMode: 'default',
      effort: 'high',
    });
    expect(frontmatter.model).toBeUndefined();
    expect(frontmatter.tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
    expect(frontmatter.mcpServers).toEqual(expect.any(Array));
    expect(body).toContain('There is no separate UAT role');
    expect(body).toContain('Playwright MCP tools');
    expect(body).toContain('isolated browser instance per session');
    expect(body).toContain(".pan/continue.json");
    expect(body).toContain('vBRIEF acceptance criteria');
    expect(body).toContain('TESTS PASSED');
    expect(body).toContain('TESTS FAILED');
  });

  // PAN-1531: ship role removed. Rebase is performed server-side by
  // rebaseFeatureBranch() in src/lib/cloister/merge-rebase.ts. See
  // docs/MERGE-WORKFLOW.md for the new two-actor design.

  it('keeps legacy pan plan/work/review/inspect/test/uat/merge agent definitions until spawn migration deletes them', () => {
    // Check sync-sources/agents/ (the committed source); .claude/agents/ is gitignored and populated by pan install.
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-planning-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-work-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-review-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-inspect-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-test-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-uat-agent.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources/agents/pan-merge-agent.md'))).toBe(true);
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
