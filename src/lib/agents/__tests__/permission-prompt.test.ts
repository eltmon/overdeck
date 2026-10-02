/**
 * PAN-4278: permission prompt parser tests against Claude Code 2.1.280 pane
 * captures.
 *
 * permission-bash, permission-dangerous-rm, permission-subagent and
 * permission-answered are verbatim probe captures (throwaway tmux server,
 * scratch cwd shortened to /tmp/probe). The selector screens are the PAN-4268
 * fixtures; the resume menu is the PAN-3113 capture from
 * tests/lib/pane-choice-menu.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePermissionPrompt, permissionKeystrokes } from '../permission-prompt.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

function fixture284(name: string): string {
  return readFileSync(new URL(`../__fixtures__/claude-code-2.1.284/${name}`, import.meta.url), 'utf8');
}

const RESUME_GATE_MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

describe('parsePermissionPrompt', () => {
  it('parses the 3-option Bash prompt', () => {
    const prompt = parsePermissionPrompt(fixture('permission-bash.txt'));
    expect(prompt).not.toBeNull();
    expect(prompt!.header).toBe('Bash command');
    expect(prompt!.fromAgent).toBeNull();
    expect(prompt!.detailLines).toEqual(['touch /tmp/pan4278-probe-marker.txt', 'Create marker file for PAN-4278 probe']);
    expect(prompt!.reason).toBeNull();
    expect(prompt!.options.map((o) => [o.number, o.label, o.choice])).toEqual([
      [1, 'Yes', 'allow-once'],
      [2, 'Yes, and always allow access to /tmp from this project', 'allow-always'],
      [3, 'No', 'deny'],
    ]);
    expect(prompt!.selectedIndex).toBe(0);
    expect(prompt!.signature).not.toBe('');
  });

  it('parses the 2-option dangerous-rm prompt with its reason', () => {
    const prompt = parsePermissionPrompt(fixture('permission-dangerous-rm.txt'));
    expect(prompt).not.toBeNull();
    expect(prompt!.header).toBe('Bash command');
    expect(prompt!.reason).toMatch(/^Dangerous rm operation on possibly-empty variable path: "\$Q"\/\*/);
    // The reason renders in its own dialog row, so it is not repeated as detail.
    expect(prompt!.detailLines).toEqual(['Q=$(pwd)/queue; rm -f "$Q"/*', 'Clear scratch queue files']);
    expect(prompt!.options.map((o) => o.choice)).toEqual(['allow-once', 'deny']);
  });

  it('parses the subagent prompt', () => {
    const prompt = parsePermissionPrompt(fixture('permission-subagent.txt'));
    expect(prompt).not.toBeNull();
    expect(prompt!.header).toBe('Bash command');
    expect(prompt!.fromAgent).toBe('general-purpose');
    expect(prompt!.detailLines).toEqual(['Q=$(pwd)/queue; rm -f "$Q"/*', 'Execute queue cleanup command']);
    expect(prompt!.reason).toMatch(/^Dangerous rm operation/);
    expect(prompt!.options.map((o) => o.choice)).toEqual(['allow-once', 'deny']);
  });

  it('keeps a subagent prompt distinct from the same main-thread prompt', () => {
    const subagent = parsePermissionPrompt(fixture('permission-subagent.txt'))!;
    const main = parsePermissionPrompt(
      fixture('permission-subagent.txt').replace(' · from the general-purpose agent', ''),
    )!;
    expect(main.fromAgent).toBeNull();
    expect(main.signature).not.toBe(subagent.signature);
  });

  it('joins a wrapped always-allow label longer than 100 characters', () => {
    const long = 'Yes, and always allow access to /home/operator/Projects/overdeck/workspaces/feature-pan-4278/.tmp/some/very/deep';
    const pane = fixture('permission-bash.txt').replace(
      '   2. Yes, and always allow access to /tmp from this project',
      `   2. ${long}\n      /directory from this project`,
    );
    const prompt = parsePermissionPrompt(pane);
    expect(prompt).not.toBeNull();
    expect(prompt!.options[1]!.label).toBe(`${long} /directory from this project`);
    expect(prompt!.options[1]!.choice).toBe('allow-always');
  });

  it('returns null for the agent selector screen', () => {
    expect(parsePermissionPrompt(fixture('subagent-selected.txt'))).toBeNull();
    expect(parsePermissionPrompt(fixture('several-subagents.txt'))).toBeNull();
    expect(parsePermissionPrompt(fixture('main-selected.txt'))).toBeNull();
  });

  it('returns null for a PAN-3113 resume menu', () => {
    expect(parsePermissionPrompt(RESUME_GATE_MENU)).toBeNull();
  });

  it('returns null once the prompt was answered and output follows', () => {
    expect(parsePermissionPrompt(fixture('permission-answered.txt'))).toBeNull();
  });

  it('returns null when no row carries the cursor', () => {
    expect(parsePermissionPrompt(fixture('permission-bash.txt').replace(' ❯ 1. Yes', '   1. Yes'))).toBeNull();
  });

  it('parses a clipped prompt whose rule and title scrolled off the screen', () => {
    const prompt = parsePermissionPrompt(fixture284('permission-subagent-clipped.txt'));
    expect(prompt).not.toBeNull();
    expect(prompt!.clipped).toBe(true);
    expect(prompt!.header).toBeNull();
    expect(prompt!.fromAgent).toBeNull();
    expect(prompt!.options.map((o) => o.choice)).toEqual(['allow-once', 'deny']);
    expect(prompt!.selectedIndex).toBe(0);
    expect(prompt!.reason).toMatch(/^Dangerous rm operation .* or use a literal path\)$/);
    expect(prompt!.detailLines[0]).toMatch(/^lectorAll\(/);
    expect(prompt!.detailLines).toContain('Retake pipeline and god view sequentially; assemble finals');
    expect(prompt!.detailLines).not.toContain('or use a literal path)');
  });

  it('parses the 2.1.280 subagent fixture with its top cut off as clipped', () => {
    const lines = fixture('permission-subagent.txt').split('\n');
    const titleIndex = lines.findIndex((line) => line.includes('Bash command · from the general-purpose agent'));
    expect(titleIndex).toBeGreaterThan(-1);
    const clippedText = lines.slice(titleIndex + 1).join('\n');
    const prompt = parsePermissionPrompt(clippedText);
    expect(prompt).not.toBeNull();
    expect(prompt!.clipped).toBe(true);
    expect(prompt!.options.map((o) => o.choice)).toEqual(['allow-once', 'deny']);
  });

  it('rejects a clipped prompt without the Esc to cancel footer', () => {
    const lines = fixture284('permission-subagent-clipped.txt').split('\n');
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    lines.pop(); // drop the "Esc to cancel · Tab to amend" line
    expect(parsePermissionPrompt(lines.join('\n'))).toBeNull();
  });

  it('rejects a clipped prompt whose question is not "Do you want to …"', () => {
    const pane = fixture284('permission-subagent-clipped.txt').replace(
      'Do you want to proceed?',
      'Allow this tool use?',
    );
    expect(parsePermissionPrompt(pane)).toBeNull();
  });

  it('keeps an unclipped prompt unclipped', () => {
    const prompt = parsePermissionPrompt(fixture('permission-bash.txt'));
    expect(prompt).not.toBeNull();
    expect(prompt!.clipped).toBe(false);
    expect(prompt!.header).toBe('Bash command');
  });

  it('gives a clipped prompt a signature distinct from the same prompt with its title', () => {
    const clipped = parsePermissionPrompt(fixture284('permission-subagent-clipped.txt'))!;
    const withTitle = parsePermissionPrompt(
      `──────────────────────────────────────\n Bash command\n\n${fixture284('permission-subagent-clipped.txt')}`,
    )!;
    expect(withTitle.clipped).toBe(false);
    expect(withTitle.signature).not.toBe(clipped.signature);
  });
});

describe('permissionKeystrokes', () => {
  it('deny keys arrow to the No row and press Enter', () => {
    const three = parsePermissionPrompt(fixture('permission-bash.txt'))!;
    expect(permissionKeystrokes(three, 'deny')).toEqual(['Down', 'Down', 'Enter']);
    const two = parsePermissionPrompt(fixture('permission-dangerous-rm.txt'))!;
    expect(permissionKeystrokes(two, 'deny')).toEqual(['Down', 'Enter']);
  });

  it('allow-once is Enter alone when the cursor is on Yes, and arrows up otherwise', () => {
    const prompt = parsePermissionPrompt(fixture('permission-bash.txt'))!;
    expect(permissionKeystrokes(prompt, 'allow-once')).toEqual(['Enter']);
    const onNo = parsePermissionPrompt(
      fixture('permission-bash.txt').replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No', ' ❯ 3. No'),
    )!;
    expect(onNo.selectedIndex).toBe(2);
    expect(permissionKeystrokes(onNo, 'allow-always')).toEqual(['Up', 'Enter']);
  });

  it('allow-always returns null when the prompt offers only 2 options', () => {
    const prompt = parsePermissionPrompt(fixture('permission-dangerous-rm.txt'))!;
    expect(permissionKeystrokes(prompt, 'allow-always')).toBeNull();
  });
});
