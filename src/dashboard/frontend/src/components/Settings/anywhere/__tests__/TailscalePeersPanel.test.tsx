import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TailscalePeersPanel } from '../TailscalePeersPanel';
import type { TailnetPeer } from '../tailscaleApi';

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const LAPTOP: TailnetPeer = {
  hostName: 'mbp',
  dnsName: 'mbp.tailnet.ts.net',
  os: 'macOS',
  online: true,
  overdeck: { environmentId: 'env-laptop', label: 'laptop', serverVersion: '0.72.0', url: 'https://mbp.tailnet.ts.net' },
};
const PHONE: TailnetPeer = { hostName: 'phone', dnsName: 'phone.tailnet.ts.net', os: 'iOS', online: true, overdeck: null };
const PRINTER: TailnetPeer = { hostName: 'printer', dnsName: null, os: 'linux', online: true, overdeck: null };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((input: string | URL | Request) => {
    if (input.toString() === '/api/tailscale/peers') return Promise.resolve(jsonResponse(200, { peers: [LAPTOP, PHONE, PRINTER] }));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TailscalePeersPanel (PAN-1254)', () => {
  it('lists Overdeck peers with their URL and counts the other devices', async () => {
    render(<TailscalePeersPanel />);
    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://mbp.tailnet.ts.net' })).toHaveAttribute('href', 'https://mbp.tailnet.ts.net');
    expect(screen.getByText('2 other tailnet devices do not run Overdeck')).toBeInTheDocument();
    expect(screen.getByText('Linking machines arrives with machine links (#4645).')).toBeInTheDocument();
  });

  it('offers no Link action', async () => {
    render(<TailscalePeersPanel />);
    await screen.findByText('laptop');
    expect(screen.queryByRole('button', { name: /^link$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^link$/i })).toBeNull();
  });

  it('fetches on mount and Refresh only, never on a timer', async () => {
    vi.useFakeTimers();
    render(<TailscalePeersPanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('laptop')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
