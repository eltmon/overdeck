/**
 * PAN-5615: role prompts must escalate with `pan tell conv-flywheel`, never
 * the retired `flywheel-orchestrator` session name — a target nothing has
 * listened on since PAN-3964 and that silently swallows the escalation.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FLYWHEEL_CONVERSATION_SESSION } from '../../flywheel/constants.js';
import { packageRoot } from '../../paths.js';
import { roleSystemPromptInjection } from '../runtime-command.js';

const DEAD_TELL_TARGET =
  /\bpan tell\s+(?:--?[\w-]+\s+)*["']?(?:conv-)?flywheel-orchestrator\b/;

function namesDeadTellTarget(text: string): boolean {
  return DEAD_TELL_TARGET.test(text);
}

function listRoleFiles(): string[] {
  return readdirSync(join(packageRoot, 'roles')).filter((f) => f.endsWith('.md'));
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules') continue;
    const abs = join(root, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) out.push(...walkFiles(abs));
    else out.push(abs);
  }
  return out;
}

describe('namesDeadTellTarget', () => {
  it('matches a pan tell pointed at the retired flywheel-orchestrator session', () => {
    expect(namesDeadTellTarget('pan tell flywheel-orchestrator "x"')).toBe(true);
    expect(namesDeadTellTarget('pan tell --steer flywheel-orchestrator "x"')).toBe(true);
    expect(namesDeadTellTarget('pan tell conv-flywheel-orchestrator "x"')).toBe(true);
  });

  it('does not match conv-flywheel or unrelated mentions of flywheel-orchestrator', () => {
    expect(namesDeadTellTarget('pan tell conv-flywheel "x"')).toBe(false);
    expect(namesDeadTellTarget('tmux capture-pane -t flywheel-orchestrator -p')).toBe(false);
    expect(namesDeadTellTarget('OVERDECK_AGENT_ID=flywheel-orchestrator')).toBe(false);
  });
});

describe('rendered role prompts never tell the dead flywheel-orchestrator target', () => {
  let tempHome: string;
  let previousOverdeckHome: string | undefined;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'role-escalation-'));
    previousOverdeckHome = process.env.OVERDECK_HOME;
    previousHome = process.env.HOME;
    process.env.OVERDECK_HOME = tempHome;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('renders every roles/*.md with no dead tell target', () => {
    const roleFiles = listRoleFiles();
    expect(roleFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let renderedCount = 0;
    for (const file of roleFiles) {
      roleSystemPromptInjection(join(packageRoot, 'roles', file));
      const rendered = readFileSync(join(tempHome, 'role-prompts', file), 'utf8');
      renderedCount += 1;
      if (namesDeadTellTarget(rendered)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
    expect(renderedCount).toBe(roleFiles.length);
    expect(renderedCount).toBeGreaterThan(0);
  });

  it('escalates plan, review, test, work and strike through conv-flywheel', () => {
    for (const role of ['plan', 'review', 'test', 'work', 'strike']) {
      roleSystemPromptInjection(join(packageRoot, 'roles', `${role}.md`));
      const rendered = readFileSync(join(tempHome, 'role-prompts', `${role}.md`), 'utf8');
      expect(rendered).toContain(`pan tell ${FLYWHEEL_CONVERSATION_SESSION} "`);
    }
  });
});

describe('sync-sources never names the dead flywheel-orchestrator tell target', () => {
  it('scans every non-binary file under sync-sources/', () => {
    const root = join(packageRoot, 'sync-sources');
    const files = walkFiles(root);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const abs of files) {
      const buf = readFileSync(abs);
      if (buf.includes(0)) continue;
      if (namesDeadTellTarget(buf.toString('utf8'))) offenders.push(relative(root, abs));
    }

    expect(offenders).toEqual([]);
  });
});
