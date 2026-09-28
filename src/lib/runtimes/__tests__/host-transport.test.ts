import { describe, expect, it } from 'vitest';

import {
  hostDisplayName,
  hostLabel,
  hostLaunchErrorFile,
  hostSessionIdFile,
  hostSocketPath,
  hostTokenFile,
  hostTransportFor,
} from '../host-transport.js';

describe('hostTransportFor (PAN-3668 WI-6, D5)', () => {
  it.each([
    ['acp', 'acp'],
    ['opencode', 'acp'],
    ['prime-agent', 'prime-agent'],
  ] as const)('maps %s to the %s transport', (harness, transport) => {
    expect(hostTransportFor(harness)).toBe(transport);
  });

  it.each(['claude-code', 'codex', 'ohmypi', 'kimi-code', 'muse', 'nope', '', null, undefined])(
    'returns null for %s',
    (harness) => {
      expect(hostTransportFor(harness)).toBeNull();
    },
  );
});

describe('host transport file names', () => {
  it('keeps the ACP names byte-identical', () => {
    expect(hostSocketPath('agent-1', 'acp', '/home/op/.overdeck')).toBe('/home/op/.overdeck/sockets/acp-agent-1.sock');
    expect(hostTokenFile('acp')).toBe('acp-token');
    expect(hostSessionIdFile('acp')).toBe('acp-session-id');
    expect(hostLaunchErrorFile('acp')).toBe('acp-launch-error');
    expect(hostDisplayName('acp')).toBe('ACP');
    expect(hostLabel('acp')).toBe('ACP host');
  });

  it('names the Prime Agent files with the prime-agent prefix', () => {
    expect(hostSocketPath('agent-1', 'prime-agent', '/home/op/.overdeck')).toBe('/home/op/.overdeck/sockets/prime-agent-agent-1.sock');
    expect(hostTokenFile('prime-agent')).toBe('prime-agent-token');
    expect(hostSessionIdFile('prime-agent')).toBe('prime-agent-session-id');
    expect(hostLaunchErrorFile('prime-agent')).toBe('prime-agent-launch-error');
    expect(hostDisplayName('prime-agent')).toBe('Prime Agent');
    expect(hostLabel('prime-agent')).toBe('Prime Agent host');
  });
});
