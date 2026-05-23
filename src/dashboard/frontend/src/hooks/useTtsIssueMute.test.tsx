import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isIssueTtsMuted, setIssueTtsMuted, useTtsIssueMute } from './useTtsIssueMute';
import type { SettingsConfig } from '../components/Settings/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const SETTINGS: SettingsConfig = {
  models: {
    providers: {
      anthropic: false,
      openai: false,
      google: false,
      minimax: false,
      zai: false,
      kimi: false,
      mimo: false,
      openrouter: false,
      nous: false,
      dashscope: false,
    },
    overrides: {},
  },
  api_keys: {},
  tracker_keys: {},
};

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('TTS issue mute helpers', () => {
  it('normalizes issue IDs when checking muted issues', () => {
    expect(isIssueTtsMuted({ ...SETTINGS, tts: { mutedIssues: ['pan-829'] } }, 'PAN-829')).toBe(true);
  });

  it('adds and removes issue IDs while preserving TTS settings', () => {
    const muted = setIssueTtsMuted({ ...SETTINGS, tts: { enabled: true, mutedIssues: ['PAN-1'] } }, 'pan-829', true);
    expect(muted.tts).toEqual({ enabled: true, mutedIssues: ['PAN-1', 'PAN-829'] });

    const unmuted = setIssueTtsMuted(muted, 'pan-829', false);
    expect(unmuted.tts).toEqual({ enabled: true, mutedIssues: ['PAN-1'] });
  });

  it('writes mutedIssues through PUT /api/settings', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/settings' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
      }
      if (url === '/api/settings') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(SETTINGS) } as Response);
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useTtsIssueMute('pan-829'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggle());

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([url, init]) => url.toString() === '/api/settings' && init?.method === 'PUT');
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall?.[1]?.body as string).tts.mutedIssues).toEqual(['PAN-829']);
    });
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });
});
