/**
 * PAN-4849 WI-10: signing off an agent-provenance disposition makes it a
 * human event; a human one needs no sign-off; unsafe paths are not found.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { signOffDisposition } from '../signoff.js';

const FIXTURE_XBRIEF = fileURLToPath(new URL('./fixtures/directive/xbrief', import.meta.url));
const SCOPE = 'xbrief/active/ui.xbrief.json';
const NOW = new Date('2026-11-02T19:00:00Z');

const scratch = mkdtempSync(join(tmpdir(), 'deft-signoff-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function worktree(): string {
  const root = mkdtempSync(join(scratch, 'wt-'));
  cpSync(FIXTURE_XBRIEF, join(root, 'xbrief'), { recursive: true });
  return root;
}
const readScope = (root: string) => JSON.parse(readFileSync(join(root, SCOPE), 'utf8'));

describe('signOffDisposition', () => {
  it('turns an agent-provenance disposition into a human event, keeping disposition and reason', async () => {
    const root = worktree();
    expect(await signOffDisposition(root, SCOPE, 'u2', 'overdeck:dashboard', NOW)).toBe('signed');
    expect(readScope(root).plan.items[1]['x-directive/disposition']).toEqual({
      disposition: 'waived',
      reason: 'Covered by unit tests',
      provenance: { kind: 'human-event', actor: 'overdeck:dashboard' },
      recorded_at: '2026-11-02T19:00:00.000Z',
    });
    expect(readdirSync(join(root, 'xbrief', 'active'))).toEqual(['ui.xbrief.json']);
  });

  it('returns not-needed for a disposition a human already signed', async () => {
    const root = worktree();
    await signOffDisposition(root, SCOPE, 'u2', 'overdeck:dashboard', NOW);
    expect(await signOffDisposition(root, SCOPE, 'u2', 'overdeck:dashboard', NOW)).toBe('not-needed');
  });

  it('returns not-found for an unsafe path, an unknown item, or an item without a disposition', async () => {
    const root = worktree();
    expect(await signOffDisposition(root, 'xbrief/../x.json', 'u2', 'overdeck:dashboard', NOW)).toBe('not-found');
    expect(await signOffDisposition(root, 'xbrief/active/../../x.xbrief.json', 'u2', 'overdeck:dashboard', NOW)).toBe('not-found');
    expect(await signOffDisposition(root, SCOPE, 'nope', 'overdeck:dashboard', NOW)).toBe('not-found');
    expect(await signOffDisposition(root, SCOPE, 'u1', 'overdeck:dashboard', NOW)).toBe('not-found');
  });
});
