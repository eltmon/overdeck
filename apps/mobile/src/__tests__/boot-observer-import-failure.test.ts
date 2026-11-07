/** PAN-5100: a failing request-failure observer import must never block the shell from loading (NFR-2). */
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
vi.mock('../../../../src/dashboard/frontend/src/lib/requestFailures', () => {
  throw new Error('module failed to load');
});

describe('main.tsx boot order with a failing observer import', () => {
  it('still loads the shell when the observer module import rejects', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('../main');

    await vi.waitFor(() => expect(order).toEqual(['shims', 'shell']));
  });
});
