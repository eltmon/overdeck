/**
 * PAN-4437 D-9 / H-4 on the real filesystem: a rollout written where
 * continueHere adopts a codex record (`codexAgentHome(<home>/agents/<tmuxSession>)`)
 * is the one the managed conversation resumes. `resolveCodexRolloutPath` must
 * return it, and the thread id the launch extracts from it must be the new
 * session id. The vault-continue unit tests mock both sides of this contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveCodexRolloutPath } from '../../../../../src/lib/agents/transcript-resolver.js';
import { getOverdeckHome } from '../../../../../src/lib/paths.js';
import { recordCodexRolloutSession } from '../../../../../src/lib/runtimes/codex.js';
import { codexAgentHome, extractThreadIdFromRollout } from '../../../../../src/lib/runtimes/storage/codex.js';
import { codexRolloutPath } from '../../../../../src/lib/vault/materialize.js';

describe('vault continue codex placement (PAN-4437 D-9)', () => {
  let root: string;
  let previous: { home?: string; overdeckHome?: string };

  // The default layout: OVERDECK_HOME is <HOME>/.overdeck, as on an operator machine.
  // (runtimes/codex.ts resolves agent directories from the user home, not OVERDECK_HOME; see #4453.)
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-4437-codex-'));
    previous = { home: process.env.HOME, overdeckHome: process.env.OVERDECK_HOME };
    process.env.HOME = root;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    for (const [key, value] of [['HOME', previous.home], ['OVERDECK_HOME', previous.overdeckHome]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('the adopted rollout is the one the managed conversation resolves and resumes', async () => {
    const tmuxSession = 'conv-20261001-abcd';
    const sessionId = randomUUID();
    const rollout = codexRolloutPath(codexAgentHome(join(getOverdeckHome(), 'agents', tmuxSession)), sessionId);
    mkdirSync(dirname(rollout), { recursive: true });
    writeFileSync(rollout, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`);

    recordCodexRolloutSession(tmuxSession, sessionId, rollout);

    expect(await resolveCodexRolloutPath(tmuxSession)).toBe(rollout);
    expect(extractThreadIdFromRollout(rollout)).toBe(sessionId);
  });
});
