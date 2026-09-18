import { describe, expect, it } from 'vitest';
import { planManagedRegionDetach } from '../../../src/lib/context-layers/detach.js';

describe('planManagedRegionDetach', () => {
  it('returns the exact removable block and preserves all surrounding bytes', () => {
    const prefix = '# User-owned\r\n\r\n';
    const block = '<!-- BEGIN OVERDECK CONTEXT — old -->\r\nmanaged\r\n<!-- END OVERDECK CONTEXT -->\r\n';
    const suffix = '\r\n# User tail\r\n';
    const plan = planManagedRegionDetach('/repo/CLAUDE.md', `${prefix}${block}${suffix}`);
    expect(plan).toEqual({ file: '/repo/CLAUDE.md', status: 'removable', managedBlock: block });
    const next = `${prefix}${block}${suffix}`.replace(plan!.managedBlock!, '');
    expect(next).toBe(`${prefix}${suffix}`);
  });

  it('refuses malformed or duplicate markers', () => {
    const duplicate = '<!-- BEGIN OVERDECK CONTEXT -->\na\n<!-- END OVERDECK CONTEXT -->\n' +
      '<!-- BEGIN OVERDECK CONTEXT -->\nb\n<!-- END OVERDECK CONTEXT -->\n';
    expect(planManagedRegionDetach('/repo/AGENTS.md', duplicate)?.status).toBe('ambiguous');
    expect(planManagedRegionDetach('/repo/AGENTS.md', '<!-- BEGIN OVERDECK CONTEXT -->')?.status).toBe('ambiguous');
  });

  it('recognizes the pre-rebrand Panopticon region', () => {
    const content = '<!-- BEGIN PANOPTICON CONTEXT -->\nlegacy\n<!-- END PANOPTICON CONTEXT -->\n';
    expect(planManagedRegionDetach('/repo/CLAUDE.md', content)?.status).toBe('removable');
  });
});
