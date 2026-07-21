import { describe, expect, it, vi } from 'vitest';
import {
  broadcastServerRestarting,
  SERVER_RESTARTING_CLOSE_CODE,
} from '../../../src/dashboard/server/ws-terminal.js';

describe('terminal restart broadcast', () => {
  it('closes only open clients with the server-restarting close code and reason', () => {
    const firstOpenClient = { readyState: 1, close: vi.fn() };
    const closedClient = { readyState: 3, close: vi.fn() };
    const secondOpenClient = { readyState: 1, close: vi.fn() };

    const clients = new Set([
      firstOpenClient,
      closedClient,
      secondOpenClient,
    ]);
    const closedCount = broadcastServerRestarting(clients);

    expect(closedCount).toBe(2);
    expect(firstOpenClient.close).toHaveBeenCalledWith(
      SERVER_RESTARTING_CLOSE_CODE,
      'server-restarting',
    );
    expect(closedClient.close).not.toHaveBeenCalled();
    expect(secondOpenClient.close).toHaveBeenCalledWith(
      SERVER_RESTARTING_CLOSE_CODE,
      'server-restarting',
    );
  });
});
