/**
 * SageOx doctor check (PAN-2444 FR-4, PAN-4852 WI-8). Silent unless the
 * `sageox` pack is registered. Then it reports whether Overdeck built `ox` for
 * the pack's trusted commit and whether that built binary answers the fork's
 * host contract probe. The build is identified by its directory and build
 * marker, not by the probe's commit, which an archive build leaves empty
 * (AD-7). There is no fallback to an `ox` on PATH (AD-7a).
 */
import { resolveOxBinary, type OxBinary } from '../../lib/sageox/binary.js';
import { probeOxHostContract, OX_HOST_CONTRACT, type OxProbeResult } from '../../lib/sageox/probe.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-tier-fitness.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface SageoxDoctorDeps {
  resolveBinary: () => Promise<OxBinary>;
  probe: (bin: string) => Promise<OxProbeResult>;
}

const NAME = 'SageOx (ox)';
const FIX = 'pan skills pack sync sageox';

const defaultDeps: SageoxDoctorDeps = {
  resolveBinary: () => resolveOxBinary(),
  probe: (bin) => probeOxHostContract({ bin }),
};

const PROBE_FAILURES: Record<Exclude<OxProbeResult, { ok: true }>['reason'], string> = {
  missing: 'built ox not executable',
  'no-contract': 'upstream ox, no host contract',
  'bad-output': 'ox host-contract printed unreadable output',
  timeout: 'ox host-contract timed out',
};

const short = (commit: string): string => commit.slice(0, 7);

export async function checkSageox(deps: SageoxDoctorDeps = defaultDeps): Promise<CheckResult[]> {
  const binary = await deps.resolveBinary();
  if (!binary.ok) {
    if (binary.reason === 'not-registered') return [];
    return [{ name: NAME, status: 'warn', message: `ox not built for pack ${short(binary.commit)}`, fix: FIX }];
  }
  const probe = await deps.probe(binary.bin);
  if (!probe.ok) return [{ name: NAME, status: 'warn', message: PROBE_FAILURES[probe.reason], fix: FIX }];
  return [{
    name: NAME,
    status: 'ok',
    message: `built ox at ${binary.bin}; host contract ${OX_HOST_CONTRACT}, ox ${probe.version || 'version unknown'}; pack ${short(binary.commit)}`,
  }];
}
