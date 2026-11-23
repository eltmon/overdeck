/**
 * PAN-5604 — showPendingInputNotification keys its toast and desktop
 * notification by tag; dismissPendingInputNotification closes both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastInfo = vi.hoisted(() => vi.fn());
const toastDismiss = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, dismiss: toastDismiss } }));

import { dismissPendingInputNotification, showPendingInputNotification } from './usePermissionNotifications';

const closeSpies = new Map<string, ReturnType<typeof vi.fn>>();

beforeEach(() => {
  vi.useFakeTimers();
  toastInfo.mockReset();
  toastDismiss.mockReset();
  closeSpies.clear();
  class FakeNotification {
    static permission = 'granted';
    onclick: (() => void) | null = null;
    onclose: (() => void) | null = null;
    close = vi.fn();
    constructor(_title: string, options?: NotificationOptions) {
      if (options?.tag) closeSpies.set(options.tag, this.close);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('showPendingInputNotification', () => {
  it('passes the tag as the toast id', () => {
    showPendingInputNotification('k', 'Title', 'Body', vi.fn());

    expect(toastInfo).toHaveBeenCalledWith('Title', expect.objectContaining({ id: 'k' }));
  });
});

describe('dismissPendingInputNotification', () => {
  it('dismisses the toast and closes the desktop notification for that tag', () => {
    showPendingInputNotification('k', 'Title', 'Body', vi.fn());

    dismissPendingInputNotification('k');

    expect(toastDismiss).toHaveBeenCalledWith('k');
    expect(closeSpies.get('k')).toHaveBeenCalledTimes(1);
  });

  it('does not close again on a second dismiss of the same tag', () => {
    showPendingInputNotification('k', 'Title', 'Body', vi.fn());

    dismissPendingInputNotification('k');
    dismissPendingInputNotification('k');

    expect(closeSpies.get('k')).toHaveBeenCalledTimes(1);
  });

  it('leaves another tag open when dismissing a different one', () => {
    showPendingInputNotification('a', 'Title A', 'Body A', vi.fn());
    showPendingInputNotification('b', 'Title B', 'Body B', vi.fn());

    dismissPendingInputNotification('a');

    expect(closeSpies.get('a')).toHaveBeenCalledTimes(1);
    expect(closeSpies.get('b')).not.toHaveBeenCalled();
  });
});
