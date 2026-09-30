/**
 * SageOx doctor check (PAN-2444 FR-4). Silent unless the `sageox` pack is
 * registered. Then it reports whether the `ox` on PATH answers the fork's host
 * contract probe and whether its build commit matches the pack's trusted
 * commit. `pan install` never installs `ox`; the fix text says how to build it.
 */
import { probeOxHostContract, OX_HOST_CONTRACT, type OxProbeResult } from '../../lib/sageox/probe.js';
import { getPack } from '../../lib/skill-packs/sources.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-tier-fitness.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface SageoxDoctorDeps {
  packCommit: () => Promise<string | null>;
  probe: () => Promise<OxProbeResult>;
}

const NAME = 'SageOx (ox)';
const FIX = 'build ox from the eltmon/ox commit trusted by the sageox pack: go build -o ~/.local/bin/ox ./cmd/ox';

const defaultDeps: SageoxDoctorDeps = {
  packCommit: async () => (await getPack('sageox'))?.commit ?? null,
  probe: () => probeOxHostContract(),
};

const PROBE_FAILURES: Record<Exclude<OxProbeResult, { ok: true }>['reason'], string> = {
  missing: 'ox not found on PATH',
  'no-contract': 'upstream ox, no host contract',
  'bad-output': 'ox host-contract printed unreadable output',
  timeout: 'ox host-contract timed out',
};

const short = (commit: string): string => commit.slice(0, 7);

export async function checkSageox(deps: SageoxDoctorDeps = defaultDeps): Promise<CheckResult[]> {
  const packCommit = await deps.packCommit();
  if (packCommit === null) return [];
  const probe = await deps.probe();
  if (!probe.ok) return [{ name: NAME, status: 'warn', message: PROBE_FAILURES[probe.reason], fix: FIX }];

  const contract = `host contract ${OX_HOST_CONTRACT}, ox ${probe.version || 'version unknown'}`;
  if (!probe.commit) {
    return [{ name: NAME, status: 'warn', message: `${contract}; build commit unknown, cannot compare with pack ${short(packCommit)}`, fix: FIX }];
  }
  if (probe.commit.startsWith(packCommit) || packCommit.startsWith(probe.commit)) {
    return [{ name: NAME, status: 'ok', message: `${contract}; commit matches pack` }];
  }
  return [{
    name: NAME,
    status: 'warn',
    message: `${contract}; commit ${short(probe.commit)} differs from pack ${short(packCommit)}`,
    fix: FIX,
  }];
}
