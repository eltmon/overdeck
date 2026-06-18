import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// Convoy reviewer prompts are harness-agnostic templates owned by Overdeck
// and inlined by the orchestrator at spawn time. They live under `roles/`,
// not `.claude/agents/`, so they cannot be auto-discovered as ambient Claude
// Code subagents and the same body drives Claude Code, Pi, and any future
// harness uniformly. See docs/ROLES.md and docs/REVIEW-AGENT-ARCHITECTURE.md.
const REVIEW_SUB_ROLES = ['security', 'correctness', 'performance', 'requirements'] as const;
const LEGACY_TEMPLATE_FLAVORS = [...REVIEW_SUB_ROLES, 'synthesis'] as const;

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

describe('code review convoy sub-role prompt templates', () => {
  for (const subRole of REVIEW_SUB_ROLES) {
    it(`defines roles/review-${subRole}.md as a frontmatter-free prompt template`, () => {
      const path = `roles/review-${subRole}.md`;
      expect(existsSync(join(process.cwd(), path))).toBe(true);

      const content = readRepoFile(path);
      // No YAML frontmatter — these are inlined into the spawn message, never
      // loaded by Claude's --agent flag, so frontmatter would only be noise.
      expect(content.startsWith('---')).toBe(false);
      expect(content.trim().length).toBeGreaterThan(100);

      // Output-file + context-manifest contract every sub-role must enforce.
      expect(content).toMatch(/Context manifest/i);
      expect(content).toMatch(/Write exactly one final report to the output file/i);
    });
  }

  it('does not keep legacy .claude/agents/code-review-* subagent files', () => {
    for (const subRole of REVIEW_SUB_ROLES) {
      expect(existsSync(join(process.cwd(), `.claude/agents/code-review-${subRole}.md`))).toBe(false);
    }
  });

  it('does not keep legacy source prompt-template files', () => {
    for (const flavor of LEGACY_TEMPLATE_FLAVORS) {
      expect(existsSync(join(process.cwd(), `src/lib/cloister/prompts/review/code-review-${flavor}.prompt-template.md`))).toBe(false);
    }
  });

  it('does not ship a separate code-review-synthesis sub-agent (synthesis is the review role itself)', () => {
    expect(existsSync(join(process.cwd(), '.claude/agents/code-review-synthesis.md'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'roles/review-synthesis.md'))).toBe(false);
  });

  it('includes the PAN-1500 Stub UI BLOCKING rule landmarks in roles/review-requirements.md', () => {
    const content = readRepoFile('roles/review-requirements.md');

    // Scope-list anchor
    expect(content).toContain('Stub UI scope creep');
    expect(content).toContain('feature flag check gating them off');
    expect(content).toContain('removal from the user-facing surface');
    expect(content).toContain('non-stub implementation calling real data');

    // Method subsection anchor
    expect(content).toContain('### Stub UI BLOCKING rule');
    expect(content).toContain('`stubUiFindings`');
    expect(content).toContain('`!` BLOCKING');

    // Coverage Matrix example row anchor
    expect(content).toContain('Stub UI: <patternLabel> @ <file>:<line>');
    expect(content).toContain('stubUiFindings (manifest)');

    // Mitigation downgrade rule
    expect(content).toContain('Non-blocking Notes');
    expect(content).toMatch(/one-line explanation of which mitigation applies/i);
  });
});
