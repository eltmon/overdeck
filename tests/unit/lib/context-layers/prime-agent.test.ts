/**
 * PAN-3668 WI-17 (FR-15): Prime Agent context is one Overdeck-owned artifact in the
 * agent directory. Overdeck writes nothing under Prime's own ~/.prime/agent home, and
 * no Claude system-prompt files are built for a Prime launch.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claudeSystemPromptFiles } from '../../../../src/lib/context-layers/launch-sources.js';
import { materializeManagedLaunchContext } from '../../../../src/lib/context-layers/materialize.js';
import { PRIME_AGENT_CONTEXT_FILE } from '../../../../src/lib/runtimes/storage/prime-agent.js';

describe('Prime Agent launch context (PAN-3668 WI-17)', () => {
  let root: string;
  let prevHome: string | undefined;
  let prevOverdeckHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-prime-context-'));
    prevHome = process.env.HOME;
    prevOverdeckHome = process.env.OVERDECK_HOME;
    process.env.HOME = join(root, 'home');
    process.env.OVERDECK_HOME = join(root, 'home', '.overdeck');
    mkdirSync(join(root, 'home', '.overdeck', 'context'), { recursive: true });
    mkdirSync(join(root, 'workspace'), { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('materializes <agentDir>/prime-agent-context.md and leaves HOME/.prime untouched', () => {
    const agentDir = join(root, 'home', '.overdeck', 'agents', 'agent-pan-3668');
    const target = join(agentDir, PRIME_AGENT_CONTEXT_FILE);

    const written = materializeManagedLaunchContext(target, join(root, 'workspace'), 'prime-agent');

    expect(written).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).not.toContain('{{#harness');
    expect(existsSync(join(root, 'home', '.prime'))).toBe(false);
  });

  it('builds no Claude system-prompt files for a Prime launch', async () => {
    await expect(claudeSystemPromptFiles(join(root, 'workspace'), 'prime-agent')).resolves.toEqual([]);
  });
});
