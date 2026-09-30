/**
 * Kimi Code CLI doctor check (ACP harness), moved out of doctor.ts so that
 * file stays under the file-size ceiling (PAN-2444).
 */
import {
  checkSystemPrerequisite,
  type PrerequisiteProbe,
  type PrerequisiteResolver,
} from '../../lib/system-prerequisites.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-tier-fitness.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function checkKimi(
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
): Promise<CheckResult[]> {
  const kimi = await checkSystemPrerequisite('kimi', probe, resolver);
  if (!kimi.found) {
    return [{
      name: kimi.name,
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: `Install: ${kimi.install.linux}`,
    }];
  }

  return [{
    name: kimi.name,
    status: 'ok',
    message: kimi.version ?? 'Installed (version unknown)',
  }];
}
