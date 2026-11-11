import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_DEFAULT_SCOPES,
  BotsForbiddenError,
  botScopes,
  cancelConnectorRequest,
  connectorAccessLabel,
  createConnectorPairing,
  dismissConnectorNotice,
  fetchConnectorNotices,
  loadConnectors,
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
  it('sends a POST with the name and scopes, and no platform key when not given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ requestId: 'req-1', pairingString: 'overdeck-connector:/pair#v=1', expiresAt: '2026-11-03T00:10:00Z' }));

    await createConnectorPairing('Hermes bot', ['read:state', 'tell']);

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/pairing', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Hermes bot', scopes: ['read:state', 'tell'] }),
    }));
  });

  it('sends platform when given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ requestId: 'req-1', pairingString: 'overdeck-connector:/pair#v=1', expiresAt: '2026-11-03T00:10:00Z' }));

    await createConnectorPairing('Grok Bot', ['read:state'], 'grok-bot');

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/pairing', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Grok Bot', scopes: ['read:state'], platform: 'grok-bot' }),
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

describe('cancelConnectorRequest', () => {
  it('sends a DELETE to the encoded request id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await cancelConnectorRequest('req/1');

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/requests/req%2F1', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('dismissConnectorNotice', () => {
  it('sends a POST to the dismiss route for the encoded notice id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await dismissConnectorNotice('notice/1');

    expect(fetchMock).toHaveBeenCalledWith('/api/connectors/requests/notice%2F1/dismiss', expect.objectContaining({ method: 'POST' }));
  });
});

describe('fetchConnectorNotices', () => {
  it('returns [] on a 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'root only' }, 403));
    await expect(fetchConnectorNotices()).resolves.toEqual([]);
  });

  it('returns [] on a body without a notices array (older server)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(fetchConnectorNotices()).resolves.toEqual([]);
  });

  it('resolves the notices array on success', async () => {
    const notices = [{ id: 'n1', connectorId: 'c1', name: 'Grok Bot', scopes: ['read:state'], pairedAt: '2026-11-03T00:00:00Z' }];
    fetchMock.mockResolvedValue(jsonResponse({ notices }));
    await expect(fetchConnectorNotices()).resolves.toEqual(notices);
  });
});

describe('connectorAccessLabel', () => {
  it('is Read + Tell for read:state, read:conversations and tell', () => {
    expect(connectorAccessLabel(['read:state', 'read:conversations', 'tell'])).toBe('Read + Tell');
  });

  it('is Read for read:state alone', () => {
    expect(connectorAccessLabel(['read:state'])).toBe('Read');
  });

  it('is Read + Tell + Operate + Approve for all five scopes', () => {
    expect(connectorAccessLabel(['read:state', 'read:conversations', 'tell', 'operate', 'approve'])).toBe('Read + Tell + Operate + Approve');
  });
});
