/**
 * PAN-5587 WI-14 (FR-11): `pan doctor` reports the optional Antigravity CLI as
 * not installed, missing a credential, or ready, and always says why OAuth is not used.
 */
import { describe, expect, it, vi } from 'vitest';

import { checkAntigravity } from '../../../src/cli/commands/doctor-antigravity.js';
import { ANTIGRAVITY_AUTH_REQUIRED, ANTIGRAVITY_OAUTH_NOT_OFFERED } from '../../../src/lib/antigravity-auth.js';

const probe = async () => '1.5.14\n';
const installed = async () => '/home/test/.local/bin/agy';
const missing = async () => null;

describe('checkAntigravity (PAN-5587)', () => {
  it('warns with the install command when agy is not installed', async () => {
    const readStatus = vi.fn(async () => ({ ready: true, method: 'gemini-api-key' as const }));
    const results = await checkAntigravity(probe, missing, readStatus);
    expect(results).toEqual([{
      name: 'Antigravity CLI',
      status: 'warn',
      message: 'Not installed (optional ACP harness)',
      fix: `Install: curl -fsSL https://antigravity.google/cli/install.sh | bash. ${ANTIGRAVITY_OAUTH_NOT_OFFERED}`,
    }]);
    expect(results[0]?.fix).toContain('clause 6');
    expect(readStatus).not.toHaveBeenCalled();
  });

  it('warns with the credential setup when no API key or Agent Platform credentials exist', async () => {
    const results = await checkAntigravity(probe, installed, async () => ({ ready: false, method: null }));
    expect(results).toEqual([{
      name: 'Antigravity CLI',
      status: 'warn',
      message: 'No API key or Agent Platform credentials',
      fix: ANTIGRAVITY_AUTH_REQUIRED,
    }]);
    expect(results[0]?.fix).toContain('clause 6');
  });

  it('reports a config read failure as a warn row instead of throwing', async () => {
    const results = await checkAntigravity(probe, installed, async () => { throw new Error('config.yaml: bad indentation'); });
    expect(results).toEqual([{
      name: 'Antigravity CLI',
      status: 'warn',
      message: 'Could not check credentials: config.yaml: bad indentation',
      fix: ANTIGRAVITY_AUTH_REQUIRED,
    }]);
  });

  it('is ok with the version and auth method when a credential is ready', async () => {
    const results = await checkAntigravity(probe, installed, async () => ({ ready: true, method: 'gemini-api-key' }));
    expect(results).toEqual([{
      name: 'Antigravity CLI',
      status: 'ok',
      message: `1.5.14, auth gemini-api-key. ${ANTIGRAVITY_OAUTH_NOT_OFFERED}`,
    }]);
    expect(results[0]?.message).toContain('clause 6');
  });
});
