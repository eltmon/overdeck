/**
 * Pi Coding Agent doctor check (pi harness, PAN-5212). Kept beside
 * doctor-grok.ts so doctor.ts stays under the file-size ceiling.
 *
 * pi is the default harness for non-Anthropic, non-OpenAI providers, but it
 * stays optional: a missing binary warns (errors under --strict), and launches
 * fail with an install hint (harness-binary.ts).
 */
import { existsSync } from 'node:fs';

import { piExtensionCandidates } from '../../lib/paths.js';
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

/** Oldest pi verified against Overdeck's launcher and extension (.pan/pi-vs-omp.md). */
export const SUPPORTED_PI_VERSION_MIN = '0.85.0';

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkPi(
  strict: boolean,
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
  extensionPresent: () => boolean = () => piExtensionCandidates().some((path) => existsSync(path)),
): Promise<CheckResult[]> {
  const pi = await checkSystemPrerequisite('pi', probe, resolver);
  if (!pi.found) {
    return [{
      name: pi.name,
      status: strict ? 'error' : 'warn',
      message: 'Not installed (pi harness unavailable; it is the default for non-Anthropic, non-OpenAI models)',
      fix: `Install: ${pi.install.linux}`,
    }];
  }

  const out: CheckResult[] = [];
  const version = pi.version?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  if (!version) {
    out.push({ name: pi.name, status: 'warn', message: 'Detected but `pi --version` did not return a version string', fix: `Reinstall: ${pi.install.linux}@latest` });
  } else if (compareSemver(version, SUPPORTED_PI_VERSION_MIN) < 0) {
    out.push({
      name: pi.name,
      status: strict ? 'error' : 'warn',
      message: `v${version} (too old — requires >= ${SUPPORTED_PI_VERSION_MIN})`,
      fix: `Upgrade: ${pi.install.linux}@latest`,
    });
  } else {
    out.push({ name: pi.name, status: 'ok', message: `v${version}` });
  }

  out.push(extensionPresent()
    ? { name: 'pi Extension Bundle', status: 'ok', message: 'pi extension bundle present' }
    : {
        name: 'pi Extension Bundle',
        status: 'warn',
        message: 'pi extension bundle not found',
        fix: 'Build it: npm run build:pi-extension && npm run build (or, in a checkout: cd packages/pi-extension && npm run build)',
      });
  return out;
}
