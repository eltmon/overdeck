/**
 * PAN-5243: the cross-process start claim. One live claim per agent id; a
 * second start is refused at once with the typed "already running" outcome; a
 * claim from a dead pid, an aged-out claim, or a torn claim file is reclaimed;
 * release never removes a claim another start owns.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AgentAlreadyRunningError,
  claimAgentStart,
  START_CLAIM_STALE_MS,
  startClaimPath,
} from '../start-claim.js';

const AGENT = 'agent-pan-5243';
let home: string;
let previousHome: string | undefined;

function writeForeignClaim(pid: number, claimedAt: string, token = 'foreign-token'): void {
  const path = startClaimPath(AGENT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ pid, claimedAt, token })}\n`);
}

function claimToken(): string | undefined {
  return JSON.parse(readFileSync(startClaimPath(AGENT), 'utf8')).token;
}

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'pan-start-claim-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('claimAgentStart (PAN-5243)', () => {
  it('refuses a second start while the first holds the claim, then allows one after release', async () => {
    const first = await claimAgentStart(AGENT);
    expect(startClaimPath(AGENT)).toBe(join(home, 'agents', AGENT, 'start.claim'));

    const second = await claimAgentStart(AGENT).catch((error: unknown) => error);
    expect(second).toBeInstanceOf(AgentAlreadyRunningError);
    expect((second as AgentAlreadyRunningError).phase).toBe('starting');
    expect((second as Error).message).toContain('already running');
    expect((second as Error).message).toContain(`pid ${process.pid}`);
    expect(claimToken()).toBe(first.holder.token);

    await first.release();
    expect(existsSync(startClaimPath(AGENT))).toBe(false);
    const third = await claimAgentStart(AGENT);
    await third.release();
  });

  it('reclaims a claim whose pid is dead', async () => {
    writeForeignClaim(424242, new Date().toISOString());
    const claim = await claimAgentStart(AGENT, { isPidAlive: (pid) => pid !== 424242 });
    expect(claimToken()).toBe(claim.holder.token);
    await claim.assertHeld();
    await claim.release();
  });

  it('reclaims a claim older than the stale window even when its pid answers', async () => {
    const now = Date.parse('2026-11-14T05:00:00.000Z');
    writeForeignClaim(process.pid, new Date(now - START_CLAIM_STALE_MS - 1).toISOString());
    const claim = await claimAgentStart(AGENT, { now: () => now, isPidAlive: () => true });
    expect(claimToken()).toBe(claim.holder.token);
    await claim.release();
  });

  it('keeps a fresh claim held by a live pid', async () => {
    const now = Date.parse('2026-11-14T05:00:00.000Z');
    writeForeignClaim(process.pid, new Date(now - 5_000).toISOString());
    await expect(claimAgentStart(AGENT, { now: () => now, isPidAlive: () => true })).rejects.toBeInstanceOf(AgentAlreadyRunningError);
    expect(claimToken()).toBe('foreign-token');
  });

  it('reclaims a torn claim file only once it is old', async () => {
    const path = startClaimPath(AGENT);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    await expect(claimAgentStart(AGENT)).rejects.toBeInstanceOf(AgentAlreadyRunningError);

    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(path, old, old);
    const claim = await claimAgentStart(AGENT);
    expect(claimToken()).toBe(claim.holder.token);
    await claim.release();
  });

  it('does not remove a claim another start took over, and reports the loss', async () => {
    const claim = await claimAgentStart(AGENT);
    writeForeignClaim(process.pid, new Date().toISOString(), 'successor-token');

    await expect(claim.assertHeld()).rejects.toBeInstanceOf(AgentAlreadyRunningError);
    await claim.release();
    expect(claimToken()).toBe('successor-token');
  });
});
