import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    rmSync(home, { recursive: true, force: true });
  });

  it('returns null when no pending deploy exists', () => {
    expect(readPendingDeploy({ overdeckHome: home })).toBeNull();
  });

  it('creates and reads a pending deploy record', () => {
    const created = recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-20', 'PAN-10'],
    }, { overdeckHome: home });

    expect(readPendingDeploy({ overdeckHome: home })).toEqual(created);
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

  it('refreshes a pending deploy without replacing its original request time', () => {
    const first = recordDeployIntent({
      requestedBy: 'agent-z',
      reason: 'First blocker',
      blockedBy: ['PAN-20', 'PAN-10', 'PAN-10'],
    }, { overdeckHome: home });
    const second = recordDeployIntent({
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

  it('returns null for invalid record shapes', () => {
    writeFileSync(join(home, 'pending-deploy.json'), JSON.stringify({ requestedAt: 42 }));

    expect(readPendingDeploy({ overdeckHome: home })).toBeNull();
  });

  it('replaces corrupt JSON with a fresh pending deploy record', () => {
    writeFileSync(join(home, 'pending-deploy.json'), '{not-json');

    expect(readPendingDeploy({ overdeckHome: home })).toBeNull();
    const created = recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    expect(readPendingDeploy({ overdeckHome: home })).toEqual(created);
    expect(created.deferralCount).toBe(1);
  });

  it('clears a pending deploy and tolerates repeated clears', () => {
    recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    clearPendingDeploy({ overdeckHome: home });
    expect(readPendingDeploy({ overdeckHome: home })).toBeNull();
    expect(existsSync(join(home, 'pending-deploy.json'))).toBe(false);
    expect(() => clearPendingDeploy({ overdeckHome: home })).not.toThrow();
  });

  it('marks an existing pending deploy as escalated and ignores absence', () => {
    expect(() => markPendingDeployEscalated({ overdeckHome: home })).not.toThrow();
    recordDeployIntent({
      requestedBy: 'agent-pan-3135',
      reason: 'Verification is running',
      blockedBy: ['PAN-10'],
    }, { overdeckHome: home });

    markPendingDeployEscalated({ overdeckHome: home });

    expect(readPendingDeploy({ overdeckHome: home })?.escalated).toBe(true);
  });
});
