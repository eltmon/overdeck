/** PAN-4651 WI-25 (D-4651-20): config.yaml flattened to dotted keys, secrets never shown. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flattenSettings, readResolvedSettings } from '../../../src/lib/settings-resolved.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'pan-4651-resolved-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('resolved settings (D-4651-20)', () => {
  it('ac25: resources.quality_gate_slots flattens to { value: "3" }', () => {
    expect(flattenSettings({ resources: { quality_gate_slots: 3 } })).toEqual({ 'resources.quality_gate_slots': { value: '3' } });
  });

  it('ac25: api_keys and secret-named keys are set/not set and their values appear nowhere', async () => {
    writeFileSync(join(home, 'config.yaml'), [
      '# comment',
      'api_keys:',
      '  openai: sk-live-abcdef',
      '  empty: ""',
      'trackers:',
      '  linear:',
      '    api_key: lin_api_secret',
      '    team: PAN',
      'agents:',
      '  rtk: { enabled: true }',
      '  models: [opus, sonnet]',
      'name: "a: b"',
      '',
    ].join('\n'));
    const settings = await readResolvedSettings(join(home, 'config.yaml'));
    expect(settings).toEqual({
      'api_keys.openai': { secret: true, set: true },
      'api_keys.empty': { secret: true, set: false },
      'trackers.linear.api_key': { secret: true, set: true },
      'trackers.linear.team': { value: 'PAN' },
      'agents.rtk.enabled': { value: 'true' },
      'agents.models': { value: '[ opus, sonnet ]' },
      name: { value: '"a: b"' },
    });
    const text = JSON.stringify(settings);
    expect(text).not.toContain('sk-');
    expect(text).not.toContain('lin_api');
  });

  it('a missing or unparsable file reads as no settings', async () => {
    expect(await readResolvedSettings(join(home, 'missing.yaml'))).toEqual({});
    writeFileSync(join(home, 'bad.yaml'), 'a: [unclosed\n');
    expect(await readResolvedSettings(join(home, 'bad.yaml'))).toEqual({});
  });
});
