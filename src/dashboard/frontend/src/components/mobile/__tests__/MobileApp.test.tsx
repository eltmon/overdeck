import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import MobileApp, { readMobileRoute } from '../MobileApp';
import { useConnectionState } from '../../../lib/connectionState';

vi.mock('../../EventRouter', () => ({ EventRouter: () => null }));

describe('readMobileRoute', () => {
  it('reads each D-3 deep link', () => {
    expect(readMobileRoute('')).toEqual({ tab: 'needs-you', subjectId: null, conversationId: null });
    expect(readMobileRoute('?subject=conv.with.dots')).toEqual({ tab: 'needs-you', subjectId: 'conv.with.dots', conversationId: null });
    expect(readMobileRoute('?tab=conversations')).toEqual({ tab: 'conversations', subjectId: null, conversationId: null });
    expect(readMobileRoute('?conversation=42')).toEqual({ tab: 'conversations', subjectId: null, conversationId: '42' });
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
});
