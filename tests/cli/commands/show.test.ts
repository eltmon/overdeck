/**
 * Tests for `pan show <id>` unified observation command.
 *
 * Verifies that flags delegate to the right view (shadow, cv, context, health)
 * and that the default path runs all four views for a compact summary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { shadowMock, cvMock, contextMock, healthMock } = vi.hoisted(() => ({
  shadowMock: vi.fn().mockResolvedValue(undefined),
  cvMock: vi.fn().mockResolvedValue(undefined),
  contextMock: vi.fn().mockResolvedValue(undefined),
  healthMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/cli/commands/shadow.js', () => ({
  shadowCommand: shadowMock,
}));
vi.mock('../../../src/cli/commands/cv.js', () => ({
  cvCommand: cvMock,
}));
vi.mock('../../../src/cli/commands/context.js', () => ({
  contextCommand: contextMock,
}));
vi.mock('../../../src/cli/commands/health.js', () => ({
  healthCommand: healthMock,
}));

import { showCommand } from '../../../src/cli/commands/show.js';

describe('showCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('flag delegation', () => {
    it('--shadow: delegates exclusively to shadowCommand', async () => {
      await showCommand('PAN-1', { shadow: true });
      expect(shadowMock).toHaveBeenCalledWith('PAN-1');
      expect(cvMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--cv: delegates exclusively to cvCommand', async () => {
      await showCommand('PAN-2', { cv: true });
      expect(cvMock).toHaveBeenCalledWith('PAN-2', { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--context: delegates exclusively to contextCommand', async () => {
      await showCommand('PAN-3', { context: true });
      expect(contextMock).toHaveBeenCalledWith('state', 'PAN-3', undefined, { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(cvMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--health: delegates exclusively to healthCommand', async () => {
      await showCommand('PAN-4', { health: true });
      expect(healthMock).toHaveBeenCalledWith('check', 'PAN-4', { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(cvMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
    });

    it('propagates --json to each delegate view', async () => {
      await showCommand('PAN-5', { cv: true, json: true });
      expect(cvMock).toHaveBeenCalledWith('PAN-5', { json: true });
    });
  });

  describe('default path (no flags)', () => {
    it('runs all four views in order for a compact summary', async () => {
      await showCommand('PAN-6');

      expect(shadowMock).toHaveBeenCalledWith('PAN-6');
      expect(cvMock).toHaveBeenCalledWith('PAN-6', { json: undefined });
      expect(healthMock).toHaveBeenCalledWith('check', 'PAN-6', { json: undefined });
      expect(contextMock).toHaveBeenCalledWith('state', 'PAN-6', undefined, { json: undefined });
    });

    it('runs shadow before cv before health before context', async () => {
      const callOrder: string[] = [];
      shadowMock.mockImplementation(async () => { callOrder.push('shadow'); });
      cvMock.mockImplementation(async () => { callOrder.push('cv'); });
      healthMock.mockImplementation(async () => { callOrder.push('health'); });
      contextMock.mockImplementation(async () => { callOrder.push('context'); });

      await showCommand('PAN-7');

      expect(callOrder).toEqual(['shadow', 'cv', 'health', 'context']);
    });

    it('propagates --json to all views in default path', async () => {
      await showCommand('PAN-8', { json: true });
      expect(cvMock).toHaveBeenCalledWith('PAN-8', { json: true });
      expect(healthMock).toHaveBeenCalledWith('check', 'PAN-8', { json: true });
      expect(contextMock).toHaveBeenCalledWith('state', 'PAN-8', undefined, { json: true });
    });
  });
});
