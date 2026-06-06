import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runGhIssueTrailerHook } from '../../sync-sources/hooks/gh-issue-trailer-hook.ts';

function payload(command: string, toolName = 'Bash'): string {
  return JSON.stringify({ tool_name: toolName, tool_input: { command } });
}

function outputFor(command: string, env: Record<string, string | undefined>, toolName = 'Bash'): Record<string, any> {
  return JSON.parse(runGhIssueTrailerHook(payload(command, toolName), env));
}

function updatedCommand(result: Record<string, any>): string {
  return result.hookSpecificOutput.updatedInput.command;
}

describe('gh issue trailer hook', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeHome(agentId = 'agent-pan-1487'): { home: string; env: Record<string, string | undefined> } {
    const home = mkdtempSync(join(tmpdir(), 'pan-gh-issue-hook-home-'));
    tempDirs.push(home);
    const stateDir = join(home, 'agents', agentId);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ issueId: 'PAN-1487' }), { encoding: 'utf-8', flag: 'w' });
    return {
      home,
      env: {
        PANOPTICON_HOME: home,
        PANOPTICON_AGENT_ID: agentId,
        PANOPTICON_FLYWHEEL_RUN_ID: 'RUN-777',
        PANOPTICON_FLYWHEEL_AGENT_ROLE: 'flywheel',
      },
    };
  }

  it('appends trailers to gh issue create --body commands', () => {
    const { env } = makeHome();

    const result = outputFor("gh issue create --title 'Bug' --body 'body text'", env);
    const command = updatedCommand(result);

    expect(command).toContain('Flywheel-Run-Id: RUN-777');
    expect(command).toContain('Flywheel-Filed-By: agent');
    expect(command).toContain('Flywheel-Discovered-In: PAN-1487');
    expect(command).toContain("--body '");
  });

  it('preserves Flywheel-Affects-Criterion trailers when appending provenance', () => {
    const { env } = makeHome();

    const result = outputFor("gh issue create --title 'Bug' --body 'body text\nFlywheel-Affects-Criterion: 5,7'", env);
    const command = updatedCommand(result);

    expect(command).toContain('Flywheel-Affects-Criterion: 5,7');
    expect(command).toContain('Flywheel-Run-Id: RUN-777');
  });

  it('copies --body-file content to a temp file with trailers appended', () => {
    const { env } = makeHome();
    const bodyDir = mkdtempSync(join(tmpdir(), 'pan-gh-issue-body-src-'));
    tempDirs.push(bodyDir);
    const bodyPath = join(bodyDir, 'body.md');
    writeFileSync(bodyPath, 'file body', 'utf-8');

    const result = outputFor(`gh issue create --title Bug --body-file ${bodyPath}`, env);
    const command = updatedCommand(result);
    const tempBodyPath = command.match(/--body-file '([^']+)'/)?.[1];

    expect(tempBodyPath).toBeDefined();
    expect(tempBodyPath).not.toBe(bodyPath);
    expect(existsSync(tempBodyPath!)).toBe(true);
    expect(readFileSync(tempBodyPath!, 'utf-8')).toContain('file body\n\n---\nFlywheel-Run-Id: RUN-777');
  });

  it('appends trailers to stdin-based --body-file - pipelines', () => {
    const { env } = makeHome();

    const result = outputFor("printf 'pipe body' | gh issue create --title Bug --body-file -", env);
    const command = updatedCommand(result);

    expect(command).toContain("{ printf 'pipe body'; printf %s '");
    expect(command).toContain('Flywheel-Run-Id: RUN-777');
    expect(command).toContain('| gh issue create --title Bug --body-file -');
  });

  it('leaves existing Flywheel-Run-Id bodies unchanged', () => {
    const { env } = makeHome();

    const result = runGhIssueTrailerHook(payload("gh issue create --title Bug --body 'body\nFlywheel-Run-Id: RUN-1'"), env);

    expect(result).toBe('{}');
  });

  it.each([
    ['Read', 'gh issue create --title Bug --body body'],
    ['Bash', 'git status'],
  ])('passes through %s %s without rewriting', (toolName, command) => {
    const { env } = makeHome();

    const result = runGhIssueTrailerHook(payload(command, toolName), env);

    expect(result).toBe('{}');
  });

  it('uses operator filed-by for non-flywheel roles and omits unresolved issue ids', () => {
    const result = outputFor("gh issue create --title Bug --body body", {
      PANOPTICON_FLYWHEEL_RUN_ID: 'RUN-777',
      PANOPTICON_FLYWHEEL_AGENT_ROLE: 'work',
      PANOPTICON_AGENT_ID: 'agent-pan-1487',
      PANOPTICON_HOME: join(tmpdir(), 'missing-panopticon-home'),
    });
    const command = updatedCommand(result);

    expect(command).toContain('Flywheel-Filed-By: operator');
    expect(command).not.toContain('Flywheel-Discovered-In:');
  });
});
