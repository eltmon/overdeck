/** PAN-5100: a throwing installRequestFailureObserver must never block the shell from loading (NFR-2). */
import { describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);

vi.mock('@overdeck/anywhere-channel/web', () => ({
  installChannelShims: vi.fn(() => {
    order.push('shims');
    return () => undefined;
  }),
}));
vi.mock('../shell/ShellApp', () => {
  order.push('shell');
  return { default: () => null };
});
vi.mock('../shell/session', () => ({ currentMachine: () => null }));
vi.mock('../../../../src/dashboard/frontend/src/index.css', () => ({}));
vi.mock('../../../../src/dashboard/frontend/src/lib/requestFailures', () => ({
  installRequestFailureObserver: vi.fn(() => { throw new Error('install failed'); }),
}));

describe('main.tsx boot order with a throwing observer install', () => {
  it('still loads the shell when installRequestFailureObserver throws', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('../main');

    await vi.waitFor(() => expect(order).toEqual(['shims', 'shell']));
  });
});
