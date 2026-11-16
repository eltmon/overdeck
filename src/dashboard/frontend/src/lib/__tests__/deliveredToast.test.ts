/**
 * PAN-5423 — showDeliveredToast adds an "Open" action to delivery success
 * toasts that navigates to the subject through the decision door, and
 * omits the action for an agent subject with no issue to open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

import { showDeliveredToast } from '../deliveredToast';

beforeEach(() => {
  toastSuccess.mockReset();
  window.history.pushState({}, '', '/');
});

describe('showDeliveredToast', () => {
  it('conversation subject: Open navigates to /conv/<name>', () => {
    showDeliveredToast('Answer delivered to Chat', { kind: 'conv', id: 'c1' });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Answer delivered to Chat',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
    );
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(window.location.pathname).toBe('/conv/c1');
  });

  it('conversation with an issueId still opens the conversation', () => {
    showDeliveredToast('Answer delivered to Chat', { kind: 'conv', id: 'c2', issueId: 'PAN-9' });
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(window.location.pathname).toBe('/conv/c2');
  });

  it('linked-machine conversation opens /conv/@env/name', () => {
    showDeliveredToast('Answer delivered to Chat', { kind: 'conv', id: '@laptop/c3' });
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(window.location.pathname).toBe('/conv/@laptop/c3');
  });

  it('agent subject with issue: Open navigates to /issues/<id>', () => {
    showDeliveredToast('Answer delivered to Agent', { kind: 'agent', id: 'agent-pan-1', issueId: 'PAN-1' });
    toastSuccess.mock.calls[0]![1].action.onClick();
    expect(window.location.pathname).toBe('/issues/PAN-1');
  });

  it('agent subject without issue: plain toast, no action', () => {
    showDeliveredToast('Answer delivered to Agent', { kind: 'agent', id: 'a1', issueId: null });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]).toHaveLength(1);
  });
});
