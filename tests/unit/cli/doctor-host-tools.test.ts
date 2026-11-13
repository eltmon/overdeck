/**
 * PAN-5168 WI-6: `pan doctor` reports a "Host tools" row from a fresh
 * resolveHostTool lookup.
 */
import { describe, expect, it } from 'vitest';

import { checkHostTools } from '../../../src/cli/commands/doctor-host-tools.js';

describe('checkHostTools (PAN-5168)', () => {
  it('names the found path and the missing tool, with the 60 s back-off note', () => {
    const find = (name: string) => (name === 'docker' ? '/usr/bin/docker' : null);

    const result = checkHostTools({ find });

    expect(result.name).toBe('Host tools');
    expect(result.status).toBe('ok');
    expect(result.message).toContain('docker /usr/bin/docker');
    expect(result.message).toContain('tmux missing');
    expect(result.message).toContain('look again every 60 s');
  });

  it('lists every path and omits "missing" when every tool is found', () => {
    const find = (name: string) => `/fake/bin/${name}`;

    const result = checkHostTools({ find });

    for (const name of ['docker', 'tmux', 'systemctl', 'journalctl', 'brew']) {
      expect(result.message).toContain(`${name} /fake/bin/${name}`);
    }
    expect(result.message).not.toContain('missing');
  });
});
