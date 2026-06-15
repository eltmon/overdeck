import { describe, it, expect } from 'vitest';

import { isPiSessionFile } from '../pi-conversation-parser.js';

describe('isPiSessionFile (PAN-1908)', () => {
  const ROOT = '/home/u/.panopticon/agents/agent-pan-1908';

  it('matches a conversation transcript in the sessions/ subdir', () => {
    expect(isPiSessionFile(`${ROOT}/sessions/2026-06-15T01-00-00-000Z_abc.jsonl`)).toBe(true);
  });

  it('matches a work-agent transcript written at the agent-dir ROOT', () => {
    // The regression: work agents write `<iso-ts>_<id>.jsonl` directly under
    // agents/<id>/, so it must be recognized as a pi file (not parsed with the
    // claude-code parser, which produced an empty "How can I help you?" panel).
    expect(isPiSessionFile(`${ROOT}/2026-06-15T06-43-53-944Z_019eca05-bbd8.jsonl`)).toBe(true);
  });

  it('does NOT match sibling non-transcript JSONLs at the root', () => {
    expect(isPiSessionFile(`${ROOT}/cost-events.jsonl`)).toBe(false);
    expect(isPiSessionFile(`${ROOT}/activity.jsonl`)).toBe(false);
  });

  it('does NOT match a claude-code project transcript', () => {
    expect(isPiSessionFile('/home/u/.claude/projects/-home-u-proj/9d08794c-3973.jsonl')).toBe(false);
  });
});
