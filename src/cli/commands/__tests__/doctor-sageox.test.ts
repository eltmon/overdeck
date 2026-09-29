/**
 * PAN-2444 O5: `pan doctor` SageOx row from an injected pack commit and probe.
 */
import { describe, expect, it } from 'vitest';
import { checkSageox, type SageoxDoctorDeps } from '../doctor-sageox.js';
import type { OxProbeResult } from '../../../lib/sageox/probe.js';

const PACK = 'a'.repeat(40);

function deps(packCommit: string | null, probe: OxProbeResult): SageoxDoctorDeps {
  return { packCommit: async () => packCommit, probe: async () => probe };
}

describe('checkSageox', () => {
  it('adds no row when the sageox pack is not registered', async () => {
    let probed = false;
    const result = await checkSageox({ packCommit: async () => null, probe: async () => { probed = true; return { ok: false, reason: 'missing' }; } });
    expect(result).toEqual([]);
    expect(probed).toBe(false);
  });

  it('is ok when the contract binary was built from the pack commit', async () => {
    expect(await checkSageox(deps(PACK, { ok: true, version: '0.19.0', commit: PACK }))).toEqual([{
      name: 'SageOx (ox)',
      status: 'ok',
      message: 'host contract overdeck-host/1, ox 0.19.0; commit matches pack',
    }]);
  });

  it('warns when the binary commit differs from the pack commit', async () => {
    const [row] = await checkSageox(deps(PACK, { ok: true, version: '0.19.0', commit: 'b'.repeat(40) }));
    expect(row).toMatchObject({ status: 'warn', message: expect.stringContaining('commit bbbbbbb differs from pack aaaaaaa') });
    expect(row?.fix).toContain('go build -o ~/.local/bin/ox ./cmd/ox');
  });

  it('warns with fix text for upstream ox without the host contract', async () => {
    expect(await checkSageox(deps(PACK, { ok: false, reason: 'no-contract' }))).toEqual([{
      name: 'SageOx (ox)',
      status: 'warn',
      message: 'upstream ox, no host contract',
      fix: 'build ox from the eltmon/ox commit trusted by the sageox pack: go build -o ~/.local/bin/ox ./cmd/ox',
    }]);
  });

  it('warns when ox is not on PATH', async () => {
    const [row] = await checkSageox(deps(PACK, { ok: false, reason: 'missing' }));
    expect(row).toMatchObject({ status: 'warn', message: 'ox not found on PATH' });
  });
});
