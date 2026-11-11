/**
 * Grok Build CLI doctor check (grok ACP harness, PAN-5078). Kept beside
 * doctor-kimi.ts so doctor.ts stays under the file-size ceiling.
 */
import { readGrokSignIn, type GrokSignIn } from '../../lib/grok-sign-in.js';
import {
  checkSystemPrerequisite,
  type PrerequisiteProbe,
  type PrerequisiteResolver,
} from '../../lib/system-prerequisites.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-kimi.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function checkGrok(
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
  readSignIn: () => Promise<GrokSignIn> = () => readGrokSignIn(),
): Promise<CheckResult[]> {
  const grok = await checkSystemPrerequisite('grok', probe, resolver);
  if (!grok.found) {
    return [{
      name: grok.name,
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: `Install: ${grok.install.linux}`,
    }];
  }

  const signIn = await readSignIn();
  if (!signIn.signedIn) {
    return [{
      name: grok.name,
      status: 'warn',
      message: `Signed out (${signIn.reason})`,
      fix: 'Run grok login',
    }];
  }

  return [{
    name: grok.name,
    status: 'ok',
    message: `${grok.version ?? 'Installed (version unknown)'}, signed in`,
  }];
}
