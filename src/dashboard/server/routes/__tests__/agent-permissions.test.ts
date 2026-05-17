import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelPermissionRequestSnapshot } from '@panctl/contracts';

import {
  buildPermissionActivityDetails,
  normalizePermissionRequestBody,
  processPermissionResponse,
} from '../agent-permissions.js';
import { validateOrigin, _resetTrustedOriginsForTests } from '../origin-validation.js';

const PENDING_REQUEST: ChannelPermissionRequestSnapshot = {
  requestId: 'perm-1',
  agentId: 'agent-1',
  issueId: 'PAN-987',
  toolName: 'Bash',
  description: 'Run npm test',
  inputPreview: '{"token":"secret-value","command":"npm test"}',
  createdAt: '2026-05-07T00:00:00.000Z',
};

describe('agent permission helpers', () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.DASHBOARD_URL;
    delete process.env.API_PORT;
    delete process.env.PORT;
    delete process.env.PANOPTICON_TRUSTED_ORIGINS;
    delete process.env.PANOPTICON_TRAEFIK_ENABLED;
    delete process.env.PANOPTICON_TRAEFIK_DOMAIN;
    _resetTrustedOriginsForTests();
  });

  it('rejects cross-origin permission response posts', () => {
    process.env.PORT = '3011';
    const result = validateOrigin({
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
      },
    } as any);
    expect(result).toEqual({ ok: false, error: 'Invalid origin' });
  });

  it('trusts the configured Traefik dashboard origin', () => {
    process.env.PORT = '3011';
    process.env.PANOPTICON_TRAEFIK_ENABLED = '1';
    process.env.PANOPTICON_TRAEFIK_DOMAIN = 'pan.localhost';
    _resetTrustedOriginsForTests();

    const result = validateOrigin({
      method: 'POST',
      headers: {
        origin: 'https://pan.localhost',
      },
    } as any);

    expect(result).toEqual({ ok: true });
  });

  it('trusts explicit comma-separated dashboard origins', () => {
    process.env.PANOPTICON_TRUSTED_ORIGINS = 'https://pan.localhost, https://admin.pan.localhost/path';
    _resetTrustedOriginsForTests();

    expect(validateOrigin({ method: 'POST', headers: { origin: 'https://pan.localhost' } } as any)).toEqual({ ok: true });
    expect(validateOrigin({ method: 'POST', headers: { origin: 'https://admin.pan.localhost' } } as any)).toEqual({ ok: true });
  });

  it('normalizes null inputPreview and rejects oversized permission payloads', () => {
    const normalized = normalizePermissionRequestBody({
      requestId: 'perm-1',
      toolName: 'Bash',
      description: 'Run npm test',
      inputPreview: null,
    });
    expect(normalized).toEqual({
      ok: true,
      value: {
        requestId: 'perm-1',
        toolName: 'Bash',
        description: 'Run npm test',
        inputPreview: '',
      },
    });

    const oversized = normalizePermissionRequestBody({
      requestId: 'perm-1',
      toolName: 'Bash',
      description: 'x'.repeat(2049),
      inputPreview: '',
    });
    expect(oversized).toEqual({
      ok: false,
      error: 'description exceeds 2048 bytes',
    });
  });

  it('redacts secrets from durable activity details', () => {
    const details = buildPermissionActivityDetails(
      'Run npm test',
      '{"token":"secret-value","authorization":"Bearer super-secret"}',
    );
    expect(details).toContain('[REDACTED]');
    expect(details).not.toContain('secret-value');
    expect(details).not.toContain('super-secret');
  });

  it('persists resolution before bridge delivery and blocks delivery on append failure', async () => {
    const appendResolutionEvents = vi.fn(async () => {
      throw new Error('sqlite locked');
    });
    const deliverDecision = vi.fn(async () => {});

    const result = await processPermissionResponse(
      {
        getPendingRequest: async () => PENDING_REQUEST,
        getResolvedDecision: async () => null,
        appendResolutionEvents,
        deliverDecision,
        emitResolvedActivity: vi.fn(),
      },
      { agentId: 'agent-1', requestId: 'perm-1', behavior: 'allow' },
    );

    expect(result).toEqual({
      status: 500,
      body: { ok: false, error: 'failed to persist permission decision: sqlite locked' },
    });
    expect(appendResolutionEvents).toHaveBeenCalledOnce();
    expect(deliverDecision).not.toHaveBeenCalled();
  });

  it('returns 502 after persistence when bridge delivery fails', async () => {
    const appendResolutionEvents = vi.fn(async () => {});
    const deliverDecision = vi.fn(async () => {
      throw new Error('bridge down');
    });

    const result = await processPermissionResponse(
      {
        getPendingRequest: async () => PENDING_REQUEST,
        getResolvedDecision: async () => null,
        appendResolutionEvents,
        deliverDecision,
        emitResolvedActivity: vi.fn(),
      },
      { agentId: 'agent-1', requestId: 'perm-1', behavior: 'allow' },
    );

    expect(result).toEqual({
      status: 502,
      body: { ok: false, error: 'failed to deliver permission decision: bridge down' },
    });
    expect(appendResolutionEvents).toHaveBeenCalledOnce();
    expect(deliverDecision).toHaveBeenCalledOnce();
  });

  it('retries safely from resolved state without appending duplicate events', async () => {
    const appendResolutionEvents = vi.fn(async () => {});
    const deliverDecision = vi.fn(async () => {});

    const result = await processPermissionResponse(
      {
        getPendingRequest: async () => null,
        getResolvedDecision: async () => ({
          requestId: 'perm-1',
          agentId: 'agent-1',
          issueId: 'PAN-987',
          behavior: 'allow',
        }),
        appendResolutionEvents,
        deliverDecision,
        emitResolvedActivity: vi.fn(),
      },
      { agentId: 'agent-1', requestId: 'perm-1', behavior: 'allow' },
    );

    expect(result).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(appendResolutionEvents).not.toHaveBeenCalled();
    expect(deliverDecision).toHaveBeenCalledWith('agent-1', 'perm-1', 'allow');
  });

  it('returns 409 when another agent already owns the request id', async () => {
    const result = await processPermissionResponse(
      {
        getPendingRequest: async () => ({ ...PENDING_REQUEST, agentId: 'agent-a' }),
        getResolvedDecision: async () => null,
        appendResolutionEvents: vi.fn(async () => {}),
        deliverDecision: vi.fn(async () => {}),
        emitResolvedActivity: vi.fn(),
      },
      { agentId: 'agent-b', requestId: 'perm-1', behavior: 'allow' },
    );

    expect(result).toEqual({
      status: 409,
      body: { ok: false, error: 'permission request perm-1 belongs to agent-a' },
    });
  });
});
