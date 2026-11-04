/**
 * PAN-4852 WI-8: `pan doctor` SageOx row from an injected built-binary
 * resolution and probe.
 */
import { describe, expect, it } from 'vitest';
import { checkSageox, type SageoxDoctorDeps } from '../doctor-sageox.js';
import { resolveOxBinary, type OxBinary } from '../../../lib/sageox/binary.js';
import type { OxProbeResult } from '../../../lib/sageox/probe.js';
import type { PackRegistryEntry } from '../../../lib/skill-packs/sources.js';

const PACK = 'a'.repeat(40);
const BIN = `/home/u/.overdeck/packs/sageox/${PACK}/bin/ox`;
const BUILT: OxBinary = { ok: true, bin: BIN, binDir: `/home/u/.overdeck/packs/sageox/${PACK}/bin`, commit: PACK };

function deps(binary: OxBinary, probe: OxProbeResult, probed: string[] = []): SageoxDoctorDeps {
  return {
    resolveBinary: async () => binary,
    probe: async (bin) => { probed.push(bin); return probe; },
  };
}

describe('checkSageox', () => {
  it('adds no row when the sageox pack is not registered', async () => {
    const probed: string[] = [];
    const binary: OxBinary = { ok: false, reason: 'not-registered', message: 'not registered' };
    expect(await checkSageox(deps(binary, { ok: false, reason: 'missing' }, probed))).toEqual([]);
    expect(probed).toEqual([]);
  });

  it('warns with the sync fix when ox is not built for the pack commit', async () => {
    const probed: string[] = [];
    const binary = await resolveOxBinary({
      getPack: async () => ({ commit: PACK } as PackRegistryEntry),
      isReady: async () => false,
    });
    expect(await checkSageox(deps(binary, { ok: true, version: '0.25.0', commit: '' }, probed))).toEqual([{
      name: 'SageOx (ox)',
      status: 'warn',
      message: 'ox not built for pack aaaaaaa',
      fix: 'pan skills pack sync sageox',
    }]);
    expect(probed).toEqual([]);
  });

  it('warns when the built ox is not executable, probing the built path', async () => {
    const probed: string[] = [];
    expect(await checkSageox(deps(BUILT, { ok: false, reason: 'missing' }, probed))).toEqual([{
      name: 'SageOx (ox)',
      status: 'warn',
      message: 'built ox not executable',
      fix: 'pan skills pack sync sageox',
    }]);
    expect(probed).toEqual([BIN]);
  });

  it('warns when the built ox lacks the host contract', async () => {
    const [row] = await checkSageox(deps(BUILT, { ok: false, reason: 'no-contract' }));
    expect(row).toMatchObject({ status: 'warn', message: 'upstream ox, no host contract', fix: 'pan skills pack sync sageox' });
  });

  it('is ok when the built ox answers the host contract, even with an empty build commit', async () => {
    const probed: string[] = [];
    expect(await checkSageox(deps(BUILT, { ok: true, version: '0.25.0', commit: '' }, probed))).toEqual([{
      name: 'SageOx (ox)',
      status: 'ok',
      message: `built ox at ${BIN}; host contract overdeck-host/1, ox 0.25.0; pack aaaaaaa`,
    }]);
    expect(probed).toEqual([BIN]);
  });
});
