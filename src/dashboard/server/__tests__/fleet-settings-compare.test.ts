/** PAN-4651 WI-27 (D-4651-20): Compare settings lists only differing keys, with copy lines, secrets as set/not set. */
import { describe, expect, it } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { buildSettingsCompare, compareSettings, shellQuote, tailnetDashboardUrl } from '../routes/fleet-settings.js';

describe('compareSettings (D-4651-20)', () => {
  it('ac27: here 2, desk 4 gives one difference with the copy line; equal keys are absent', () => {
    const differences = compareSettings(
      { 'resources.quality_gate_slots': { value: '2' }, 'agents.rtk.enabled': { value: 'true' } },
      { 'resources.quality_gate_slots': { value: '4' }, 'agents.rtk.enabled': { value: 'true' } },
    );
    expect(differences).toEqual([{ key: 'resources.quality_gate_slots', here: { value: '2' }, there: { value: '4' }, copyLine: 'pan admin config set resources.quality_gate_slots 2' }]);
  });

  it('ac27: differing API keys show set on both sides and no copy line; unset on both sides is absent', () => {
    const differences = compareSettings(
      { 'api_keys.openai': { secret: true, set: true }, 'api_keys.none': { secret: true, set: false } },
      { 'api_keys.openai': { secret: true, set: true } },
    );
    expect(differences).toEqual([{ key: 'api_keys.openai', here: { secret: true, set: true }, there: { secret: true, set: true }, copyLine: null }]);
  });

  it('a key only the other machine sets has no copy line; a value with spaces is quoted', () => {
    expect(compareSettings({}, { 'a.b': { value: '1' } })).toEqual([{ key: 'a.b', here: null, there: { value: '1' }, copyLine: null }]);
    expect(compareSettings({ name: { value: '"a: b"' } }, {})[0]!.copyLine).toBe(`pan admin config set name '"a: b"'`);
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('ac27: offers the dashboard only with a tailnet wss route', () => {
    expect(tailnetDashboardUrl({ routes: [{ url: 'wss://desk.tail1234.ts.net/ws/link', kind: 'tailnet', source: 'pairing', addedAt: 'x' }] } as MachineLink)).toBe('https://desk.tail1234.ts.net/');
    expect(tailnetDashboardUrl({ routes: [{ url: 'tcp://192.168.1.5:3011', kind: 'lan', source: 'pairing', addedAt: 'x' }] } as MachineLink)).toBeNull();
  });

  it('answers machine, dashboardUrl and differences; an older peer is peer-too-old', async () => {
    const link = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null, routes: [] } as unknown as MachineLink;
    const ok = await buildSettingsCompare('desk', {
      getLink: async () => link,
      here: async () => ({ 'resources.quality_gate_slots': { value: '2' } }),
      there: async () => ({ status: 200, json: { settings: { 'resources.quality_gate_slots': { value: '4' } } } }),
    });
    expect(ok).toMatchObject({ status: 200, body: { machine: { environmentId: 'env-desk', label: 'desk' }, dashboardUrl: null } });
    const old = await buildSettingsCompare('desk', { getLink: async () => link, here: async () => ({}), there: async () => ({ status: 403, json: { error: 'insufficient_scope' } }) });
    expect(old).toMatchObject({ status: 409, body: { code: 'peer-too-old' } });
  });
});
