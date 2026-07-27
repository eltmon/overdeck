import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingDeploy,
  markPendingDeployEscalated,
  readPendingDeploy,
  recordDeployIntent,
} from '../../../../src/lib/deploy/deploy-queue.js';

describe('deploy queue', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'overdeck-deploy-queue-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  it('returns null when no pending deploy exists', async () => {
    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toBeNull();
  });

  it('creates and reads a pending deploy record', async () => {
    const created = await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-20', 'PAN-10'],
    }, { overdeckHome: home });

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toEqual(created);
    expect(created).toEqual({
      requestedAt: created.requestedAt,
      requestedBy: ['agent-pan-3135'],
      lastReason: 'Verification is running',
      blockedBy: ['PAN-10', 'PAN-20'],
      deferralCount: 1,
      escalated: false,
    });
    expect(JSON.parse(readFileSync(join(home, 'pending-deploy.json'), 'utf8'))).toEqual(created);
  });

  it('refreshes a pending deploy without replacing its original request time', async () => {
    const first = await recordDeployIntent({
      requestedBy: 'agent-z',
      reason: 'First blocker',
      blockedBy: ['PAN-20', 'PAN-10', 'PAN-10'],
    }, { overdeckHome: home });
    const second = await recordDeployIntent({
      requestedBy: 'agent-a',
      reason: 'Second blocker',
      blockedBy: ['PAN-30', 'PAN-20'],
    }, { overdeckHome: home });

    expect(second).toEqual({
      requestedAt: first.requestedAt,
      requestedBy: ['agent-a', 'agent-z'],
      lastReason: 'Second blocker',
      blockedBy: ['PAN-10', 'PAN-20', 'PAN-30'],
      deferralCount: 2,
      escalated: false,
    });
  });

  it('serializes concurrent registrations without losing callers or blockers', async () => {
    await Promise.all([
      recordDeployIntent({
        requestedBy: 'agent-z',
        reason: 'First blocker',
        blockedBy: ['PAN-20'],
      }, { overdeckHome: home }),
      recordDeployIntent({
        requestedBy: 'agent-a',
        reason: 'Second blocker',
        blockedBy: ['PAN-10'],
      }, { overdeckHome: home }),
    ]);

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toMatchObject({
      requestedBy: ['agent-a', 'agent-z'],
      blockedBy: ['PAN-10', 'PAN-20'],
      deferralCount: 2,
    });
  });

  it('preserves escalation across concurrent registration and escalation', async () => {
    await recordDeployIntent({
      requestedBy: 'agent-a',
      reason: 'First blocker',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    await Promise.all([
      markPendingDeployEscalated({ overdeckHome: home }),
      recordDeployIntent({
        requestedBy: 'agent-z',
        reason: 'Second blocker',
        blockedBy: ['PAN-20'],
      }, { overdeckHome: home }),
    ]);

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toMatchObject({
      requestedBy: ['agent-a', 'agent-z'],
      blockedBy: ['PAN-10', 'PAN-20'],
      deferralCount: 2,
      escalated: true,
    });
  });

  it('reclaims a lock immediately when its recorded owner is dead', async () => {
    const lockPath = join(home, 'pending-deploy.lock');
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
      pid: 2_147_483_647,
      acquiredAt: new Date().toISOString(),
    }));

    await expect(recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home })).resolves.toMatchObject({ deferralCount: 1 });
    expect(existsSync(lockPath)).toBe(false);
  });

  it('reclaims an ownerless lock left by a crash without waiting for the stale timeout', async () => {
    const lockPath = join(home, 'pending-deploy.lock');
    mkdirSync(lockPath);

    await expect(recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home })).resolves.toMatchObject({ deferralCount: 1 });
    expect(existsSync(lockPath)).toBe(false);
  });

  it('returns null for invalid record shapes', async () => {
    writeFileSync(join(home, 'pending-deploy.json'), JSON.stringify({ requestedAt: 42 }));

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toBeNull();
  });

  it('replaces corrupt JSON with a fresh pending deploy record', async () => {
    writeFileSync(join(home, 'pending-deploy.json'), '{not-json');

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toBeNull();
    const created = await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toEqual(created);
    expect(created.deferralCount).toBe(1);
  });

  it('clears a pending deploy and tolerates repeated clears', async () => {
    await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    await clearPendingDeploy({ overdeckHome: home });
    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toBeNull();
    expect(existsSync(join(home, 'pending-deploy.json'))).toBe(false);
    await expect(clearPendingDeploy({ overdeckHome: home })).resolves.toBeUndefined();
  });

  it('marks an existing pending deploy as escalated and ignores absence', async () => {
    await expect(markPendingDeployEscalated({ overdeckHome: home })).resolves.toBeUndefined();
    await recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    await markPendingDeployEscalated({ overdeckHome: home });

    await expect(readPendingDeploy({ overdeckHome: home })).resolves.toMatchObject({ escalated: true });
  });
});
