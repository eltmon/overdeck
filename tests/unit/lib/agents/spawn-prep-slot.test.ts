import { describe, expect, it } from 'vitest';
import { resolveRegisteredSlotSpawn } from '../../../../src/lib/agents/spawn-prep.js';

describe('resolveRegisteredSlotSpawn', () => {
  it('returns null for the default one-work-agent path', () => {
    expect(resolveRegisteredSlotSpawn('PAN-1762', '/repo/workspaces/feature-pan-1762', {})).toBeNull();
  });

  it('derives per-item slot agent, branch, and workspace names', () => {
    expect(resolveRegisteredSlotSpawn('PAN-1762', '/repo/workspaces/feature-pan-1762', {
      slotIndex: 2,
      slotItemId: 'workspace-qcwbs',
    })).toEqual({
      agentId: 'agent-pan-1762-slot-2',
      branch: 'feature/pan-1762-slot-2',
      workspace: '/repo/workspaces/feature-pan-1762-slot-2',
      slotIndex: 2,
      slotItemId: 'workspace-qcwbs',
    });
  });

  it('requires complete slot options', () => {
    expect(() => resolveRegisteredSlotSpawn('PAN-1762', '/repo/workspaces/feature-pan-1762', {
      slotIndex: 1,
    })).toThrow('requires both slotIndex and slotItemId');
  });

  it('rejects non-positive slot indexes', () => {
    expect(() => resolveRegisteredSlotSpawn('PAN-1762', '/repo/workspaces/feature-pan-1762', {
      slotIndex: 0,
      slotItemId: 'workspace-qcwbs',
    })).toThrow('positive integer');
  });
});
