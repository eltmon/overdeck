/**
 * PAN-4849 WI-3: resolving a Deft escalation rewrites its file in place,
 * atomically, and refuses a second answer or an unsafe id.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

const deliverAgentMessage = vi.hoisted(() => vi.fn());
vi.mock('../../agents/delivery.js', () => ({ deliverAgentMessage }));

const { notifyEscalationResolved, resolveDeftEscalation } = await import('../escalations.js');

const FIXTURE_ESCALATIONS = fileURLToPath(new URL('./fixtures/directive/.deft/escalations', import.meta.url));
const ESC = 'esc-20261102120000-aaaaaa';
const NOW = new Date('2026-11-02T18:30:00Z');

const scratch = mkdtempSync(join(tmpdir(), 'deft-escalations-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function worktree(): string {
  const root = mkdtempSync(join(scratch, 'wt-'));
  cpSync(FIXTURE_ESCALATIONS, join(root, '.deft', 'escalations'), { recursive: true });
  return root;
}

const readEscalation = (root: string, id: string) =>
  JSON.parse(readFileSync(join(root, '.deft', 'escalations', `${id}.json`), 'utf8'));

describe('resolveDeftEscalation', () => {
  it('rewrites the file as resolved and leaves every other field unchanged', async () => {
    const root = worktree();
    const before = readEscalation(root, ESC);

    expect(await resolveDeftEscalation(root, ESC, { decision: 'denied', note: 'too risky', actor: 'operator:dashboard' }, NOW)).toBe('resolved');

    expect(readEscalation(root, ESC)).toEqual({
      ...before,
      status: 'resolved',
      resolution: { decision: 'denied', resolvedAt: '2026-11-02T18:30:00.000Z', resolvedBy: 'operator:dashboard', note: 'too risky', answer: null },
    });
    expect(readdirSync(join(root, '.deft', 'escalations')).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('returns already-resolved for a second answer', async () => {
    const root = worktree();
    await resolveDeftEscalation(root, ESC, { decision: 'approved', actor: 'operator:dashboard' }, NOW);
    expect(await resolveDeftEscalation(root, ESC, { decision: 'denied', actor: 'operator:dashboard' }, NOW)).toBe('already-resolved');
    expect(readEscalation(root, ESC).resolution.decision).toBe('approved');
  });

  it('returns not-found for an unsafe or unknown id and writes nothing', async () => {
    const root = worktree();
    const names = readdirSync(join(root, '.deft', 'escalations')).sort();
    expect(await resolveDeftEscalation(root, '../x', { decision: 'approved', actor: 'operator:dashboard' }, NOW)).toBe('not-found');
    expect(await resolveDeftEscalation(root, 'esc-20990101000000-ffffff', { decision: 'approved', actor: 'operator:dashboard' }, NOW)).toBe('not-found');
    expect(readdirSync(join(root, '.deft', 'escalations')).sort()).toEqual(names);
  });
});

describe('notifyEscalationResolved', () => {
  it('tells the work agent and reports delivery', async () => {
    deliverAgentMessage.mockResolvedValueOnce({ ok: true, path: 'herdr' });
    expect(await notifyEscalationResolved('PAN-1', ESC, 'answered', 'use port 8080')).toEqual({ delivered: true });
    expect(deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-1',
      `Operator resolved Deft escalation ${ESC}: answered — use port 8080`,
      'deft-escalation-answer',
    );
  });

  it('reports a failed or throwing delivery without throwing', async () => {
    deliverAgentMessage.mockResolvedValueOnce({ ok: false, path: 'herdr', failure: 'no pane' });
    expect(await notifyEscalationResolved('PAN-1', ESC, 'approved')).toEqual({ delivered: false, failure: 'no pane' });
    deliverAgentMessage.mockRejectedValueOnce(new Error('boom'));
    expect(await notifyEscalationResolved('PAN-1', ESC, 'approved')).toEqual({ delivered: false, failure: 'boom' });
  });
});
