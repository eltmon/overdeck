import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installStrictFetchMock } from '../../test-utils/strictFetchMock';
import { useDesignLanguage } from '../useDesignLanguage';

vi.mock('../../lib/wsTransport', () => ({ dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })) }));

describe('useDesignLanguage', () => {
  let mockLocalStorage: Record<string, string>;
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    mockLocalStorage = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      length: 0,
      key: vi.fn(() => null),
    };

    document.documentElement.dataset.theme = '';
    useDesignLanguage.setState({ designLanguage: 'broadsheet' });
  });

  afterEach(async () => {
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete document.documentElement.dataset.theme;
  });

  describe('eager initialization', () => {
    it('applies broadsheet by default when the mirror is empty', () => {
      fetchControl = installStrictFetchMock(() => undefined);
      const { result } = renderHook(() => useDesignLanguage());
      expect(result.current.designLanguage).toBe('broadsheet');
    });

    it('reads ledger from the mirror when present', () => {
      fetchControl = installStrictFetchMock(() => undefined);
      mockLocalStorage['overdeck.ui.designLanguage'] = 'ledger';
      useDesignLanguage.setState({ designLanguage: 'ledger' });
      const { result } = renderHook(() => useDesignLanguage());
      expect(result.current.designLanguage).toBe('ledger');
    });
  });

  describe('setDesignLanguage', () => {
    it('flips document.documentElement.dataset.theme immediately on success and persists the mirror', async () => {
      fetchControl = installStrictFetchMock(({ method, url }) => {
        if (method === 'PUT' && url === '/api/settings/design-language') {
          return Response.json({ success: true });
        }
        return undefined;
      });

      const { result } = renderHook(() => useDesignLanguage());

      await act(async () => {
        await result.current.setDesignLanguage('ledger');
      });

      expect(document.documentElement.dataset.theme).toBe('ledger');
      expect(localStorage.setItem).toHaveBeenCalledWith('overdeck.ui.designLanguage', 'ledger');
      expect(result.current.designLanguage).toBe('ledger');
    });

    it('PUTs only { theme } to /api/settings/design-language — no GET, no full-document round trip (PAN-3410 no-loss guarantee, FR-7)', async () => {
      fetchControl = installStrictFetchMock(({ method, url }) => {
        if (method === 'PUT' && url === '/api/settings/design-language') {
          return Response.json({ success: true });
        }
        return undefined;
      });

      const { result } = renderHook(() => useDesignLanguage());
      await act(async () => {
        await result.current.setDesignLanguage('ledger');
      });

      // No GET at all — a concurrent settings save (another tab, or the
      // top-level Settings form) has nothing to clobber, since this call
      // never holds a stale snapshot of any other field.
      expect(fetchControl.fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'GET')).toBe(false);

      const putCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
      const body = JSON.parse(String((putCall?.[1] as RequestInit).body));
      expect(body).toEqual({ theme: 'ledger' });
    });

    it('throws and leaves state unchanged when the PUT fails', async () => {
      fetchControl = installStrictFetchMock(({ method, url }) => {
        if (method === 'PUT' && url === '/api/settings/design-language') {
          return new Response(JSON.stringify({ error: 'ui.theme must be ledger or broadsheet' }), { status: 400 });
        }
        return undefined;
      });

      const { result } = renderHook(() => useDesignLanguage());

      await expect(act(async () => {
        await result.current.setDesignLanguage('ledger');
      })).rejects.toThrow('Failed to save ui.theme');

      expect(result.current.designLanguage).toBe('broadsheet');
      expect(document.documentElement.dataset.theme).not.toBe('ledger');
    });
  });

  describe('reconcileFromServer', () => {
    it('reconciles to the server value and re-stamps the mirror when it differs from the local mirror', async () => {
      mockLocalStorage['overdeck.ui.designLanguage'] = 'broadsheet';
      fetchControl = installStrictFetchMock(({ method, url }) => {
        if (method === 'GET' && url === '/api/settings') {
          return Response.json({ ui: { theme: 'ledger' } });
        }
        return undefined;
      });

      const { result } = renderHook(() => useDesignLanguage());
      await act(async () => {
        await result.current.reconcileFromServer();
      });

      expect(result.current.designLanguage).toBe('ledger');
      expect(document.documentElement.dataset.theme).toBe('ledger');
      expect(localStorage.setItem).toHaveBeenCalledWith('overdeck.ui.designLanguage', 'ledger');
    });

    it('defaults to broadsheet when the server omits ui.theme', async () => {
      fetchControl = installStrictFetchMock(({ method, url }) => {
        if (method === 'GET' && url === '/api/settings') {
          return Response.json({});
        }
        return undefined;
      });

      const { result } = renderHook(() => useDesignLanguage());
      await act(async () => {
        await result.current.reconcileFromServer();
      });

      expect(result.current.designLanguage).toBe('broadsheet');
    });

    it('is best-effort — a failed fetch keeps the locally-stamped value', async () => {
      mockLocalStorage['overdeck.ui.designLanguage'] = 'ledger';
      useDesignLanguage.setState({ designLanguage: 'ledger' });
      fetchControl = installStrictFetchMock(() => {
        throw new Error('network unavailable');
      });

      const { result } = renderHook(() => useDesignLanguage());
      await act(async () => {
        await result.current.reconcileFromServer();
      });

      expect(result.current.designLanguage).toBe('ledger');
    });
  });
});
