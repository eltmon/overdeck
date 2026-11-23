/**
 * PAN-4242 WI-7 (FR-8, NFR-4): a resume by respawn sends a failed fork's held,
 * never-delivered kickoff once, in place of the generic resume notice. An
 * operator hold (`hold: true` in the fork request) is never sent by a resume.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notice = vi.hoisted(() => ({ deliver: vi.fn(async () => 'delivered' as const) }));

vi.mock('../resume-contract-delivery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resume-contract-delivery.js')>()),
  deliverResumeContractUnlessGated: notice.deliver,
}));

const { deliverResumeNoticeOrKickoff } = await import('../conversation-undelivered-kickoff.js');
const { createConversation, getConversationByName, setForkRequest, updateForkStatus } = await import('../conversations.js');
const { forkRequestedHold, holdKickoff, readHeldKickoff } = await import('../conversation-kickoff-store.js');

let testHome: string;
let originalHome: string | undefined;

const NOTICE = { text: 'CONVERSATION RESUME: carry on', caller: 'conversation-resume', method: undefined, send: true };

function seedConversation(name: string, forkRequest: Record<string, unknown> | null, kickoff: string | null) {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
  if (forkRequest) setForkRequest(name, JSON.stringify(forkRequest));
  if (kickoff !== null) holdKickoff(name, kickoff);
  return getConversationByName(name)!;
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4242-resume-kickoff-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  notice.deliver.mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('deliverResumeNoticeOrKickoff (PAN-4242)', () => {
  it('delivers an undelivered kickoff in place of the resume notice', async () => {
    const conv = seedConversation('undelivered', { handoffFocus: 'fix it' }, 'the kickoff');
    expect(conv.forkStatus ?? null).toBeNull();
    const deliverKickoff = vi.fn(async () => undefined);

    const result = await deliverResumeNoticeOrKickoff(conv, NOTICE, deliverKickoff);

    expect(result).toBe('delivered');
    expect(deliverKickoff).toHaveBeenCalledWith(expect.objectContaining({ name: 'undelivered' }), 'the kickoff', 'conversation-resume-kickoff');
    expect(notice.deliver).not.toHaveBeenCalled();
    expect(readHeldKickoff('undelivered')).toBeNull();
  });

  it('restores the kickoff and marks the fork failed when its delivery fails', async () => {
    const conv = seedConversation('refused-again', {}, 'the kickoff');
    // The real deliverer (deliverForkSeed) sets 'injecting' before it can throw.
    const deliverKickoff = vi.fn(async () => {
      updateForkStatus('refused-again', 'injecting');
      throw new Error('refused: agent_blocked');
    });

    const result = await deliverResumeNoticeOrKickoff(conv, NOTICE, deliverKickoff);

    expect(result).toBe('failed');
    expect(readHeldKickoff('refused-again')).toBe('the kickoff');
    const after = getConversationByName('refused-again')!;
    expect(after.forkStatus).toBe('failed');
    expect(after.forkError).toBe('refused: agent_blocked');
    expect(notice.deliver).not.toHaveBeenCalled();
  });

  it('never sends a kickoff the operator held', async () => {
    const conv = seedConversation('operator-hold', { hold: true }, 'the kickoff');
    const deliverKickoff = vi.fn(async () => undefined);

    const result = await deliverResumeNoticeOrKickoff(conv, NOTICE, deliverKickoff);

    expect(result).toBe('delivered');
    expect(deliverKickoff).not.toHaveBeenCalled();
    expect(notice.deliver).toHaveBeenCalledWith('conv-operator-hold', NOTICE.text, NOTICE.caller, NOTICE.method, true);
    expect(readHeldKickoff('operator-hold')).toBe('the kickoff');
  });

  it('sends the resume notice when nothing is held', async () => {
    const conv = seedConversation('nothing-held', null, null);
    const deliverKickoff = vi.fn(async () => undefined);

    await deliverResumeNoticeOrKickoff(conv, NOTICE, deliverKickoff);

    expect(deliverKickoff).not.toHaveBeenCalled();
    expect(notice.deliver).toHaveBeenCalledTimes(1);
  });

  it('leaves the kickoff held when the caller has no deliverer', async () => {
    const conv = seedConversation('no-deliverer', {}, 'the kickoff');

    await deliverResumeNoticeOrKickoff(conv, NOTICE);

    expect(notice.deliver).toHaveBeenCalledTimes(1);
    expect(readHeldKickoff('no-deliverer')).toBe('the kickoff');
  });
});

describe('forkRequestedHold (PAN-4242)', () => {
  it('is true only for a fork request with hold: true', () => {
    expect(forkRequestedHold('{"hold":true}')).toBe(true);
    expect(forkRequestedHold('{}')).toBe(false);
    expect(forkRequestedHold(null)).toBe(false);
    expect(forkRequestedHold('not json')).toBe(false);
  });
});
