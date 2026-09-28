/**
 * PAN-4278 — permission prompt notifications (usePermissionNotifications,
 * mounted by usePendingInputDialogs): first sight, then 5 and 30 minutes
 * after the prompt started waiting, never after it clears.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo } }));

import type { TerminalPendingPermission } from '../../components/TerminalPermissionDialog';
import { usePermissionNotifications, type PermissionNotificationRow } from './usePermissionNotifications';

const START = new Date('2026-09-27T15:32:21.000Z');

const permission: TerminalPendingPermission = {
  signature: 'Bash command::rm::1:Yes|2:No',
  answerable: true,
  agentLabel: 'Subagent: Research Orca onboarding flow',
  agentKey: 'a9ef',
  toolName: 'Bash',
  header: 'Bash command',
  detailLines: ['rm -f queue/*'],
  reason: null,
  options: [],
  since: START.toISOString(),
};

const pending: PermissionNotificationRow[] = [{ name: '20260927-3978', title: 'Orca study', pendingPermission: permission }];

function render(rows: PermissionNotificationRow[], onOpen = vi.fn()) {
  return renderHook(({ feed }: { feed: PermissionNotificationRow[] }) => usePermissionNotifications(feed, onOpen), {
    initialProps: { feed: rows },
  });
}

/** Desktop notifications created, as their titles. */
const notifications: Array<{ title: string; options?: NotificationOptions }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  toastInfo.mockReset();
  notifications.length = 0;
  class FakeNotification {
    static permission = 'granted';
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) { notifications.push({ title, options }); }
    close(): void {}
  }
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePendingInputDialogs permission notifications', () => {
  it('notifies once on first sight', () => {
    const { rerender } = render(pending);
    rerender({ feed: [...pending] });
    expect(notifications.map((n) => n.title)).toEqual(['Permission needed']);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('Permission needed', expect.objectContaining({
      description: 'Orca study · Subagent: Research Orca onboarding flow · Bash',
    }));
  });

  it('re-notifies at 5 and 30 minutes', async () => {
    render(pending);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(toastInfo).toHaveBeenCalledTimes(2);
    expect(toastInfo).toHaveBeenLastCalledWith('Permission needed', expect.objectContaining({
      description: expect.stringMatching(/^Still waiting · /),
    }));
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(toastInfo).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(toastInfo).toHaveBeenCalledTimes(3);
    expect(notifications.map((n) => n.title)).toEqual(['Permission needed', 'Permission needed', 'Permission needed']);
  });

  it('times reminders from since, skipping ones already past', async () => {
    vi.setSystemTime(new Date(START.getTime() + 10 * 60_000));
    render(pending);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(toastInfo).toHaveBeenCalledTimes(2);
  });

  it('no re-notify after the permission clears', async () => {
    const { rerender } = render(pending);
    rerender({ feed: [{ name: '20260927-3978', title: 'Orca study' }] });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);
  });

  it('the Answer action opens the conversation', () => {
    const onOpen = vi.fn();
    render(pending, onOpen);
    const options = toastInfo.mock.calls[0]![1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(onOpen).toHaveBeenCalledWith('20260927-3978');
  });
});
