import { describe, expect, it } from 'vitest';
import { renderTable } from '../../../scripts/windows-smoke/summarize.mjs';

type Step = { id: string; status: string; command: string; exitCode: number | null; evidence: string; note: string };

function results(env: string, steps: Step[]) {
  return { env, runner: `${env} runner`, node: 'v22.0.0', git: 'git version 2.x', subject: 'overdeck-core-0.63.0.tgz @ abc', steps };
}

function step(id: string, status: string, evidence = '', note = ''): Step {
  return { id, status, command: `cmd ${id}`, exitCode: status === 'fail' ? 1 : 0, evidence, note };
}

function row(markdown: string, id: string): string {
  const line = markdown.split('\n').find((l) => l.startsWith(`| ${id} `));
  if (!line) throw new Error(`no row for ${id}`);
  return line;
}

describe('windows-smoke summarize renderTable', () => {
  const pwsh = results('windows-pwsh', [
    step('3a', 'pass'),
    step('3c', 'fail', 'npm warn EBADENGINE noise\nError: spawn EINVAL | claude.cmd\nat ChildProcess'),
  ]);
  const wsl = results('wsl2', [step('3a', 'pass')]);

  it('renders a pass cell and escapes a pipe in a fail cell, keeping one column per env', () => {
    const md = renderTable([wsl, pwsh]);

    expect(md).toContain('| Step | windows-pwsh | wsl2 |');
    expect(row(md, '3a')).toBe('| 3a vault join | ✅ pass | ✅ pass |');
    const failRow = row(md, '3c');
    expect(failRow).toContain('❌ fail: Error: spawn EINVAL \\| claude.cmd');
    expect(failRow.split(/(?<!\\)\|/)).toHaveLength(5);
  });

  it('shows the note of a fail that has one instead of its first evidence line', () => {
    const md = renderTable([results('windows-pwsh', [step('1c', 'fail', '--- serve stdout ---\nGET / -> 404', 'server up, GET / -> 404')])]);

    expect(row(md, '1c')).toContain('❌ fail: server up, GET / -> 404');
  });

  it('marks a step a results file lacks as missing', () => {
    const md = renderTable([wsl, pwsh]);

    expect(row(md, '3c')).toMatch(/\| missing \|$/);
    expect(row(md, '5a')).toBe('| 5a WSL2 available | missing | missing |');
  });

  it('writes a details block with the verbatim evidence for the fail only', () => {
    const md = renderTable([pwsh], { runUrl: 'https://github.com/eltmon/overdeck/actions/runs/1' });

    expect(md).toContain('Run: https://github.com/eltmon/overdeck/actions/runs/1');
    const details = md.split('## Details')[1] ?? '';
    expect(details.match(/<details>/g)).toHaveLength(1);
    expect(details).toContain('<summary>3c vault resume --no-launch · windows-pwsh · fail</summary>');
    expect(details).toContain('npm warn EBADENGINE noise\nError: spawn EINVAL | claude.cmd\nat ChildProcess');
    expect(details).not.toContain('3a vault join');
  });
});
