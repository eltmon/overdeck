/**
 * Antigravity CLI doctor check (antigravity ACP harness, PAN-5587 FR-11). Kept
 * beside doctor-grok.ts so doctor.ts stays under the file-size ceiling.
 *
 * Every result says why Overdeck never uses Antigravity's Google sign-in (OAuth).
 */
import {
  ANTIGRAVITY_AUTH_REQUIRED,
  ANTIGRAVITY_OAUTH_NOT_OFFERED,
  readAntigravityAuthStatus,
  type AntigravityAuthMethod,
} from '../../lib/antigravity-auth.js';
import {
  checkSystemPrerequisite,
  type PrerequisiteProbe,
  type PrerequisiteResolver,
} from '../../lib/system-prerequisites.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-grok.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function checkAntigravity(
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
  readStatus: () => Promise<{ ready: boolean; method: AntigravityAuthMethod | null }> = () => readAntigravityAuthStatus(),
): Promise<CheckResult[]> {
  const agy = await checkSystemPrerequisite('agy', probe, resolver);
  if (!agy.found) {
    return [{
      name: agy.name,
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: `Install: ${agy.install.linux}. ${ANTIGRAVITY_OAUTH_NOT_OFFERED}`,
    }];
  }

  let status: { ready: boolean; method: AntigravityAuthMethod | null };
  try {
    status = await readStatus();
  } catch (error) {
    // A config read or parse failure is a doctor finding, not a crash of the whole report.
    return [{
      name: agy.name,
      status: 'warn',
      message: `Could not check credentials: ${error instanceof Error ? error.message : String(error)}`,
      fix: ANTIGRAVITY_AUTH_REQUIRED,
    }];
  }
  if (!status.ready) {
    return [{
      name: agy.name,
      status: 'warn',
      message: 'No API key or Agent Platform credentials',
      fix: ANTIGRAVITY_AUTH_REQUIRED,
    }];
  }

  return [{
    name: agy.name,
    status: 'ok',
    message: `${agy.version ?? 'Installed (version unknown)'}, auth ${status.method}. ${ANTIGRAVITY_OAUTH_NOT_OFFERED}`,
  }];
}
