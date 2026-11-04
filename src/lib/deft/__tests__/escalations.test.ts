/**
 * PAN-4849 WI-3: resolving a Deft escalation rewrites its file in place,
 * atomically, and refuses a second answer or an unsafe id.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('resolveDeftEscalation, review fixes (PAN-4849)', () => {
  const custom = (root: string, file: string, id: string) =>
    writeFileSync(join(root, '.deft', 'escalations', file), JSON.stringify({ ...readEscalation(root, ESC), id }));

  it('resolves a custom Deft id by the id parsed from the file', async () => {
    const root = worktree();
    custom(root, 'deploy-approval.json', 'deploy-approval');
    custom(root, 'renamed-file.json', 'other-id');
    expect(await resolveDeftEscalation(root, 'deploy-approval', { decision: 'approved', actor: 'operator:dashboard' }, NOW)).toBe('resolved');
    expect(await resolveDeftEscalation(root, 'other-id', { decision: 'denied', actor: 'operator:dashboard' }, NOW)).toBe('resolved');
    expect(JSON.parse(readFileSync(join(root, '.deft', 'escalations', 'renamed-file.json'), 'utf8')).resolution.decision).toBe('denied');
  });

  it('never follows a symlink out of the escalations directory', async () => {
    const root = worktree();
    const outside = mkdtempSync(join(scratch, 'outside-'));
    writeFileSync(join(outside, 'x.json'), JSON.stringify({ id: 'escaped', status: 'open' }));
    symlinkSync(join(outside, 'x.json'), join(root, '.deft', 'escalations', 'escaped.json'));
    expect(await resolveDeftEscalation(root, 'escaped', { decision: 'approved', actor: 'operator:dashboard' }, NOW)).toBe('not-found');
    expect(JSON.parse(readFileSync(join(outside, 'x.json'), 'utf8')).status).toBe('open');
  });

  it('serializes concurrent resolves: one wins, the other is already-resolved', async () => {
    const root = worktree();
    const results = await Promise.all([
      resolveDeftEscalation(root, ESC, { decision: 'approved', actor: 'operator:dashboard' }, NOW),
      resolveDeftEscalation(root, ESC, { decision: 'denied', actor: 'operator:dashboard' }, NOW),
    ]);
    expect(results.sort()).toEqual(['already-resolved', 'resolved']);
    expect(readEscalation(root, ESC).resolution.decision).toBe('approved');
    expect(readdirSync(join(root, '.deft', 'escalations')).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses ids with path characters', async () => {
    const root = worktree();
    for (const bad of ['a/b', 'a\\b', '..', 'x..y', '']) {
      expect(await resolveDeftEscalation(root, bad, { decision: 'approved', actor: 'operator:dashboard' }, NOW)).toBe('not-found');
    }
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
