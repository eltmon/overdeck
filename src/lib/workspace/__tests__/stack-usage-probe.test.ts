/**
 * PAN-5250 WI-3: the usage probe's parsers and its deny-by-default reads.
 * Fixture strings only; nothing here runs docker or reads the host /proc.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  countInboundConnections,
  isLoopbackHex,
  parseInspectUsage,
  probeContainerUsage,
} from '../stack-usage-probe.js';

const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const HEADER6 = '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const tail = '00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0';

function table(header: string, rows: [string, string, string][]): string {
  return [header, ...rows.map(([local, remote, state], index) => `   ${index}: ${local} ${remote} ${state} ${tail}`)].join('\n');
}

const LISTEN_3010 = ['00000000:0BC2', '00000000:0000', '0A'] as [string, string, string];

describe('isLoopbackHex', () => {
  it('recognizes IPv4 and IPv6 loopback forms', () => {
    expect(isLoopbackHex('0100007F')).toBe(true);
    expect(isLoopbackHex('0200A8C0')).toBe(false);
    expect(isLoopbackHex('00000000000000000000000001000000')).toBe(true);
    expect(isLoopbackHex('0000000000000000FFFF00000100007F')).toBe(true);
    expect(isLoopbackHex('0000000000000000FFFF0000050012AC')).toBe(false);
  });
});

describe('countInboundConnections', () => {
  it('counts an established non-loopback peer on a listening port', () => {
    const tcp = table(HEADER, [LISTEN_3010, ['050012AC:0BC2', '0200A8C0:D431', '01']]);
    expect(countInboundConnections(tcp, '')).toBe(1);
  });

  it('ignores a loopback peer', () => {
    const tcp = table(HEADER, [LISTEN_3010, ['0100007F:0BC2', '0100007F:D431', '01']]);
    expect(countInboundConnections(tcp, '')).toBe(0);
  });

  it('ignores an outbound connection on a non-listening local port', () => {
    const tcp = table(HEADER, [LISTEN_3010, ['050012AC:D431', '0200A8C0:01BB', '01']]);
    expect(countInboundConnections(tcp, '')).toBe(0);
  });

  it('ignores a v4-mapped loopback peer in tcp6 and counts a non-loopback one', () => {
    const listen6 = ['00000000000000000000000000000000:0BC2', '00000000000000000000000000000000:0000', '0A'] as [string, string, string];
    const loop = table(HEADER6, [listen6, ['0000000000000000FFFF00000100007F:0BC2', '0000000000000000FFFF00000100007F:D431', '01']]);
    expect(countInboundConnections('', loop)).toBe(0);
    const remote = table(HEADER6, [listen6, ['0000000000000000FFFF0000050012AC:0BC2', 'FE800000000000000000000001000000:D431', '01']]);
    expect(countInboundConnections('', remote)).toBe(1);
  });

  it('counts a v4-mapped peer on a port that only tcp6 lists as listening', () => {
    const tcp = table(HEADER, []);
    const tcp6 = table(HEADER6, [
      ['00000000000000000000000000000000:0BC2', '00000000000000000000000000000000:0000', '0A'],
      ['0000000000000000FFFF0000060012AC:0BC2', '0000000000000000FFFF0000050012AC:D431', '01'],
    ]);
    expect(countInboundConnections(tcp, tcp6)).toBe(1);
  });
});

describe('parseInspectUsage', () => {
  it('strips the leading slash and reads pid and exec sessions', () => {
    const usage = parseInspectUsage('/myn-feature-min-1-fe-1\t1234\t2\n');
    expect(usage.get('myn-feature-min-1-fe-1')).toEqual({ pid: 1234, execSessions: 2 });
  });

  it('skips malformed rows', () => {
    expect(parseInspectUsage('/a\tnope\t0\n/b\t1\n').size).toBe(0);
  });
});

describe('probeContainerUsage', () => {
  const tcp = table(HEADER, [LISTEN_3010, ['050012AC:0BC2', '0200A8C0:D431', '01']]);

  it('maps a pid of 0 to unknown', async () => {
    const result = await probeContainerUsage(['a-fe-1'], {
      inspect: async () => '/a-fe-1\t0\t0',
      readProcFile: async () => tcp,
    });
    expect(result?.get('a-fe-1')).toBe('unknown');
  });

  it('maps an EACCES tcp read to unknown', async () => {
    const result = await probeContainerUsage(['a-fe-1'], {
      inspect: async () => '/a-fe-1\t42\t0',
      readProcFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    });
    expect(result?.get('a-fe-1')).toBe('unknown');
  });

  it('counts tcp only when tcp6 is missing', async () => {
    const readProcFile = vi.fn(async (path: string) => {
      if (path.endsWith('tcp6')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return tcp;
    });
    const result = await probeContainerUsage(['a-fe-1'], { inspect: async () => '/a-fe-1\t42\t1', readProcFile });
    expect(result?.get('a-fe-1')).toEqual({ inboundConnections: 1, execSessions: 1 });
    expect(readProcFile).toHaveBeenCalledWith('/proc/42/net/tcp');
  });

  it('maps a tcp6 read error other than ENOENT to unknown', async () => {
    const result = await probeContainerUsage(['a-fe-1'], {
      inspect: async () => '/a-fe-1\t42\t0',
      readProcFile: async (path: string) => {
        if (path.endsWith('tcp6')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return tcp;
      },
    });
    expect(result?.get('a-fe-1')).toBe('unknown');
  });

  it('returns null when the inspect call fails', async () => {
    expect(await probeContainerUsage(['a-fe-1'], { inspect: async () => null })).toBeNull();
  });

  it('maps an invalid or uninspected name to unknown without passing it to docker', async () => {
    const inspect = vi.fn(async () => '/a-fe-1\t42\t0');
    const result = await probeContainerUsage(['a-fe-1', 'bad name', 'a-dev-1'], {
      inspect,
      readProcFile: async (path: string) => (path.endsWith('tcp6') ? '' : tcp),
    });
    expect(inspect).toHaveBeenCalledWith(['a-fe-1', 'a-dev-1']);
    expect(result?.get('bad name')).toBe('unknown');
    expect(result?.get('a-dev-1')).toBe('unknown');
    expect(result?.get('a-fe-1')).toEqual({ inboundConnections: 1, execSessions: 0 });
  });
});
