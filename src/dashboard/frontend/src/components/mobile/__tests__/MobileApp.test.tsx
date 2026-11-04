import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MobileApp, { readMobileRoute } from '../MobileApp';
import { MobilePairScreen, parsePairingInput } from '../MobilePairScreen';
import { useConnectionState } from '../../../lib/connectionState';

vi.mock('../../EventRouter', () => ({ EventRouter: () => null }));
// The shell is under test here; the screens have their own suites.
vi.mock('../MobileNeedsYou', () => ({ MobileNeedsYou: () => <h2>Needs you</h2> }));
vi.mock('../MobileConversations', () => ({ MobileConversations: () => <h2>Conversations</h2> }));
vi.mock('../MobilePipeline', () => ({
  MobilePipeline: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <button type="button" onClick={() => onOpen('PAN-7')}>pipeline-row</button>
  ),
}));
vi.mock('../MobileIssueSheet', () => ({
  MobileIssueSheet: ({ issueId, onBack }: { issueId: string; onBack: () => void }) => (
    <div>
      <h2>{`sheet ${issueId}`}</h2>
      <button type="button" onClick={onBack}>Back</button>
    </div>
  ),
}));
vi.mock('../../push/TurnOnNotificationsButton', () => ({ TurnOnNotificationsButton: () => null }));

const decodeQr = vi.fn<(data: Uint8ClampedArray, width: number, height: number) => { data: string } | null>(() => null);
vi.mock('jsqr', () => ({ default: (data: Uint8ClampedArray, width: number, height: number) => decodeQr(data, width, height) }));

describe('readMobileRoute', () => {
  it('reads each D-3 deep link', () => {
    expect(readMobileRoute('')).toEqual({ tab: 'needs-you', subjectId: null, conversationId: null, issueId: null });
    expect(readMobileRoute('?subject=conv.with.dots')).toEqual({ tab: 'needs-you', subjectId: 'conv.with.dots', conversationId: null, issueId: null });
    expect(readMobileRoute('?tab=conversations')).toEqual({ tab: 'conversations', subjectId: null, conversationId: null, issueId: null });
    expect(readMobileRoute('?conversation=42')).toEqual({ tab: 'conversations', subjectId: null, conversationId: '42', issueId: null });
    expect(readMobileRoute('?conversation=%40env-a%2Fconv-9')).toEqual({ tab: 'conversations', subjectId: null, conversationId: '@env-a/conv-9', issueId: null });
  });

  it('reads the D-4661-3 pipeline path, with the pipeline tab taking precedence over every other query parameter', () => {
    expect(readMobileRoute('', '/m/pipeline')).toEqual({ tab: 'pipeline', issueId: null, subjectId: null, conversationId: null });
    expect(readMobileRoute('?issue=PAN.1', '/m/pipeline/')).toEqual({ tab: 'pipeline', issueId: 'PAN.1', subjectId: null, conversationId: null });
    expect(readMobileRoute('?conversation=4', '/m/pipeline')).toEqual({ tab: 'pipeline', issueId: null, subjectId: null, conversationId: null });
  });
});

describe('MobileApp', () => {
  const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);

  function setSecureContext(value: boolean) {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
  }

  beforeEach(() => {
    window.history.replaceState(null, '', '/m');
    useConnectionState.setState({ sessionAuthFailed: false });
    register.mockClear();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    vi.stubEnv('DEV', false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    useConnectionState.setState({ sessionAuthFailed: false });
  });

  it('renders the pair screen when the session mint failed', () => {
    useConnectionState.setState({ sessionAuthFailed: true });
    render(<MobileApp />);
    expect(screen.getByRole('heading', { name: 'Pair this phone' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Phone sections' })).not.toBeInTheDocument();
  });

  it('registers the service worker once in a secure context', () => {
    setSecureContext(true);
    render(<MobileApp />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does not register the service worker outside a secure context', () => {
    setSecureContext(false);
    render(<MobileApp />);
    expect(register).not.toHaveBeenCalled();
  });

  it('shows the Install button after beforeinstallprompt', () => {
    setSecureContext(false);
    render(<MobileApp />);
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const install = screen.getByRole('button', { name: 'Install app' });
    act(() => {
      install.click();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('switches tabs through the URL', () => {
    setSecureContext(false);
    render(<MobileApp />);
    act(() => {
      screen.getByRole('button', { name: 'Conversations' }).click();
    });
    expect(window.location.search).toBe('?tab=conversations');
    expect(screen.getByRole('heading', { name: 'Conversations' })).toBeInTheDocument();
  });

  it('tapping the Pipeline tab pushes /m/pipeline and marks it current', () => {
    setSecureContext(false);
    render(<MobileApp />);
    act(() => {
      screen.getByRole('button', { name: 'Pipeline' }).click();
    });
    expect(window.location.pathname).toBe('/m/pipeline');
    expect(screen.getByRole('button', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
  });

  it('opening a pipeline row shows the full-screen sheet, and Back restores the list and navigation', () => {
    setSecureContext(false);
    window.history.replaceState(null, '', '/m/pipeline');
    render(<MobileApp />);

    act(() => {
      screen.getByRole('button', { name: 'pipeline-row' }).click();
    });
    expect(window.location.search).toBe('?issue=PAN-7');
    expect(screen.getByRole('heading', { name: 'sheet PAN-7' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Phone sections' })).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Back' }).click();
    });
    expect(window.location.pathname).toBe('/m/pipeline');
    expect(window.location.search).toBe('');
    expect(screen.getByRole('navigation', { name: 'Phone sections' })).toBeInTheDocument();
  });
});

const CODE = `odp_${'ab12'.repeat(16)}`;

describe('MobileApp in the phone app (PAN-4837)', () => {
  const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);
  const native = globalThis as { __OVERDECK_NATIVE__?: boolean };

  beforeEach(() => {
    window.history.replaceState(null, '', '/m');
    native.__OVERDECK_NATIVE__ = true;
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    register.mockClear();
    vi.stubEnv('DEV', false);
  });

  afterEach(() => {
    delete native.__OVERDECK_NATIVE__;
    vi.unstubAllEnvs();
    useConnectionState.setState({ sessionAuthFailed: false });
  });

  it('never shows the PWA pair screen, even when the session mint failed', () => {
    useConnectionState.setState({ sessionAuthFailed: true });
    render(<MobileApp />);
    expect(screen.queryByRole('heading', { name: 'Pair this phone' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Phone sections' })).toBeInTheDocument();
  });

  it('renders headerSlot in place of the install control and registers no service worker', () => {
    render(<MobileApp headerSlot={<button type="button">desk ▾</button>} />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByRole('button', { name: 'desk ▾' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});

describe('parsePairingInput', () => {
  const origin = 'https://desk.ts.net';

  it('accepts a bare code and a same-origin link', () => {
    expect(parsePairingInput(CODE, origin)).toEqual({ credential: CODE });
    expect(parsePairingInput(`  https://desk.ts.net/m#pair=${CODE} `, origin)).toEqual({ credential: CODE });
  });

  it('rejects a link for another origin and garbage', () => {
    expect(parsePairingInput(`https://other.ts.net/m#pair=${CODE}`, origin)).toEqual({
      error: 'This code is for https://other.ts.net. Open Overdeck at that address instead.',
    });
    expect(parsePairingInput('hello', origin)).toEqual({ error: 'That is not an Overdeck pairing code.' });
  });
});

describe('MobilePairScreen', () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    reload.mockClear();
    decodeQr.mockReset().mockReturnValue(null);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: originalLocation.origin, reload },
    });
  });

  afterEach(() => {
    replaceState.mockRestore();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'videoWidth');
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'videoHeight');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('hands a pasted link to the bootstrap', () => {
    render(<MobilePairScreen />);
    fireEvent.change(screen.getByLabelText('Pairing link'), { target: { value: `${originalLocation.origin}/m#pair=${CODE}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(replaceState).toHaveBeenCalledWith(null, '', `/m#pair=${CODE}`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to pasting when the camera is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new Error('denied'); }) },
    });
    render(<MobilePairScreen />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scan pairing code' }));
    });
    expect(screen.getByText('Camera is not available. Paste the pairing link instead.')).toBeInTheDocument();
    const input = screen.getByLabelText('Pairing link');
    fireEvent.change(input, { target: { value: 'typed' } });
    expect(input).toHaveValue('typed');
  });

  it('pairs from a scanned code and stops the camera', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    // happy-dom accepts only a real MediaStream here.
    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    // happy-dom has no video dimensions.
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 2 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
    } as unknown as CanvasRenderingContext2D);
    decodeQr.mockReturnValueOnce(null).mockReturnValue({ data: `${originalLocation.origin}/m#pair=${CODE}` });

    render(<MobilePairScreen />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scan pairing code' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(replaceState).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(replaceState).toHaveBeenCalledWith(null, '', `/m#pair=${CODE}`);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalled();
  });
});
