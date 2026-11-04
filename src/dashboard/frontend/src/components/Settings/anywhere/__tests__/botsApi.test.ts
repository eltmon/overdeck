import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_DEFAULT_SCOPES,
  BotsForbiddenError,
  botScopes,
  createConnectorPairing,
  loadConnectors,
  loadPublicMcp,
  removeConnector,
} from '../botsApi';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('botScopes', () => {
  it('filters out scopes outside the bot choices and always keeps read:state', () => {
    expect(botScopes(['tell', 'admin', 'forward'])).toEqual(['read:state', 'tell']);
  });

  it('adds read:state even when nothing is chosen', () => {
    expect(botScopes([])).toEqual(['read:state']);
  });

  it('returns the default scopes in choice order when every default is chosen', () => {
    expect(botScopes(BOT_DEFAULT_SCOPES)).toEqual(['read:state', 'read:conversations', 'tell']);
  });
});

describe('loadPublicMcp', () => {
  it('reads a 404 as unavailable and off (D-6)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
    await expect(loadPublicMcp()).resolves.toEqual({ available: false, enabled: false, url: null });
  });

  it('maps an enabled route to its base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ enabled: true, baseUrl: 'https://h.ts.net:8443/mcp' }));
    await expect(loadPublicMcp()).resolves.toEqual({
      available: true,
      enabled: true,
      url: 'https://h.ts.net:8443/mcp',
    });
  });
});

describe('loadConnectors', () => {
  it('throws BotsForbiddenError on a 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'root only' }, 403));
    await expect(loadConnectors()).rejects.toBeInstanceOf(BotsForbiddenError);
  });

  it('resolves the connector rows on success', async () => {
    const connectors = [{ id: 'c1', name: 'Hermes bot', scopes: ['read:state'], createdAt: '2026-11-03T00:00:00Z', lastUsedAt: null }];
    fetchMock.mockResolvedValue(jsonResponse({ connectors }));
    await expect(loadConnectors()).resolves.toEqual(connectors);
  });
});

describe('createConnectorPairing', () => {
  it('sends a POST with the name and scopes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pairingString: 'overdeck-connector:/pair#v=1', expiresAt: '2026-11-03T00:10:00Z' }));

    await createConnectorPairing('Hermes bot', ['read:state', 'tell']);

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/pairing', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Hermes bot', scopes: ['read:state', 'tell'] }),
    }));
  });
});

describe('removeConnector', () => {
  it('sends a DELETE to the encoded connector id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await removeConnector('conn/1');

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/conn%2F1', expect.objectContaining({ method: 'DELETE' }));
  });
});
