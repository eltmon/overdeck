/**
 * PAN-5212: `pan doctor` reports the pi harness binary, its version floor and
 * the bundled pi extension.
 */
import { describe, expect, it } from 'vitest';

import { checkPi, SUPPORTED_PI_VERSION_MIN } from '../../../src/cli/commands/doctor-pi.js';

const installed = async () => '/home/test/.nvm/bin/pi';
const missing = async () => null;
const version = (out: string) => async () => out;

describe('checkPi (PAN-5212)', () => {
  it('warns with the npm install command when pi is missing, and errors under --strict', async () => {
    const [warn] = await checkPi(false, version('0.85.0\n'), missing, () => true);
    expect(warn).toMatchObject({ name: 'Pi Coding Agent', status: 'warn', fix: 'Install: npm install -g @earendil-works/pi-coding-agent' });
    const [error] = await checkPi(true, version('0.85.0\n'), missing, () => true);
    expect(error?.status).toBe('error');
  });

  it('is ok on the verified version with the extension bundle present', async () => {
    await expect(checkPi(false, version('0.85.0\n'), installed, () => true)).resolves.toEqual([
      { name: 'Pi Coding Agent', status: 'ok', message: 'v0.85.0' },
      { name: 'pi Extension Bundle', status: 'ok', message: 'pi extension bundle present' },
    ]);
  });

  it('flags a pi older than the supported floor', async () => {
    const [result] = await checkPi(false, version('0.79.0\n'), installed, () => true);
    expect(result).toMatchObject({ status: 'warn', message: `v0.79.0 (too old — requires >= ${SUPPORTED_PI_VERSION_MIN})` });
  });

  it('warns when the pi extension bundle is not built', async () => {
    const results = await checkPi(false, version('0.85.0\n'), installed, () => false);
    expect(results[1]).toMatchObject({ name: 'pi Extension Bundle', status: 'warn' });
  });
});
