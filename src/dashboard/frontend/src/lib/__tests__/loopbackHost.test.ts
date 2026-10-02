import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from '../loopbackHost';

describe('isLoopbackHost', () => {
  it.each(['localhost', 'overdeck.localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['192.168.1.20', 'overdeck.example.com', 'localhost.evil.com', '128.0.0.1', '127.0.0'])(
    'treats %s as remote',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
