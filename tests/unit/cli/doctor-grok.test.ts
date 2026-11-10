/**
 * PAN-5078 WI-15 (FR-11): `pan doctor` reports the optional Grok Build CLI as
 * not installed, signed out or ready.
 */
import { describe, expect, it, vi } from 'vitest';

import { checkGrok } from '../../../src/cli/commands/doctor-grok.js';

const probe = async () => 'grok 1.0.77 (50ca579fa996) [stable]\n';
const installed = async () => '/home/test/.grok/bin/grok';
const missing = async () => null;

describe('checkGrok (PAN-5078)', () => {
  it('warns with the install command when grok is not installed', async () => {
    const readSignIn = vi.fn(async () => ({ signedIn: true, reason: 'ok' as const }));
    await expect(checkGrok(probe, missing, readSignIn)).resolves.toEqual([{
      name: 'Grok Build CLI',
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: 'Install: curl -fsSL https://x.ai/cli/install.sh | bash',
    }]);
    expect(readSignIn).not.toHaveBeenCalled();
  });

  it('warns with grok login when grok is signed out', async () => {
    await expect(checkGrok(probe, installed, async () => ({ signedIn: false, reason: 'expired' }))).resolves.toEqual([{
      name: 'Grok Build CLI',
      status: 'warn',
      message: 'Signed out (expired)',
      fix: 'Run grok login',
    }]);
  });

  it('is ok with the version when grok is installed and signed in', async () => {
    await expect(checkGrok(probe, installed, async () => ({ signedIn: true, reason: 'ok' }))).resolves.toEqual([{
      name: 'Grok Build CLI',
      status: 'ok',
      message: 'grok 1.0.77 (50ca579fa996) [stable], signed in',
    }]);
  });
});
