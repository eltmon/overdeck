/**
 * PAN-3920 W19 / AC-19 — `POST /api/workers/register` body validation. The
 * route and `pan worker register` share one validator; the Effect route itself
 * is not unit-testable, so the pure `parseRegisterBody` is.
 */
import { describe, expect, it } from 'vitest';

import { parseRegisterBody } from '../workers-register.js';

const VALID = { source: 'my-tool', externalId: 'run-7', harness: 'codex' };

describe('parseRegisterBody', () => {
  it('accepts the minimal body', () => {
    const parsed = parseRegisterBody(VALID);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.input).toMatchObject({ source: 'my-tool', externalId: 'run-7', harness: 'codex', pid: null });
  });

  it('rejects a missing harness', () => {
    expect(parseRegisterBody({ source: 'my-tool', externalId: 'run-7' })).toMatchObject({ ok: false, error: expect.stringMatching(/harness/) });
  });

  it('rejects a bad source and the reserved adapter source', () => {
    expect(parseRegisterBody({ ...VALID, source: '../etc' })).toMatchObject({ ok: false, error: expect.stringMatching(/source/) });
    expect(parseRegisterBody({ ...VALID, source: 'codex-plugin' })).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
  });

  it('rejects path-shaped ids, relative paths, bad pids and non-object bodies', () => {
    expect(parseRegisterBody({ ...VALID, externalId: '../../x' }).ok).toBe(false);
    expect(parseRegisterBody({ ...VALID, parent: 'conv a' }).ok).toBe(false);
    expect(parseRegisterBody({ ...VALID, transcript: 'relative.jsonl' }).ok).toBe(false);
    expect(parseRegisterBody({ ...VALID, pid: -3 }).ok).toBe(false);
    expect(parseRegisterBody({ ...VALID, issue: 'not an issue' }).ok).toBe(false);
    expect(parseRegisterBody([VALID]).ok).toBe(false);
    expect(parseRegisterBody(null).ok).toBe(false);
  });

  it('accepts a claude-session parent and normalizes the issue id', () => {
    const parsed = parseRegisterBody({ ...VALID, parent: 'claude-session:b4e68a48-1e09', issue: 'pan-12', pid: '77' });
    expect(parsed.ok && parsed.value.input).toMatchObject({ parentId: 'claude-session:b4e68a48-1e09', issueId: 'PAN-12', pid: 77 });
  });
});
