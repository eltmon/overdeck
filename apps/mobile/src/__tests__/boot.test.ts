/** D-3 / H-3: main.tsx installs the channel shims before the shell (and every frontend module) loads. */
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

describe('main.tsx boot order', () => {
  it('installs the shims and sets the native flag before the shell module evaluates', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../main');
    await vi.waitFor(() => expect(order).toEqual(['shims', 'shell']));
    expect((globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__).toBe(true);
  });
});
