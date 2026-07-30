/**
 * PAN-3286 WI-6: SessionStart standing briefing (FR-10, D-7, NFR-6).
 *
 * Covers composition from local sources within SESSION_START_MEMORY_BUDGETS,
 * the at-most-once-per-session dedup marker, and the degradation paths — a
 * composition failure and disabled observations must both leave the existing
 * SessionStart response untouched.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity, MemoryObservation, MemoryStatus } from '@overdeck/contracts';
import {
  claimSessionBriefing,
  composeSessionStartBriefing,
  readSessionBriefingMarker,
  SESSION_BRIEFING_TAG,
  SESSION_START_MEMORY_BUDGETS,
} from '../../../src/lib/memory/session-briefing.js';
import { handleMemorySessionStartBody } from '../../../src/dashboard/server/routes/hooks.js';

let tempHome: string;
let transcriptPath: string;
let savedHome: { present: boolean; value: string | undefined };

const identity: MemoryIdentity = {
  projectId: 'overdeck',
  workspaceId: 'workspace-pan-3286',
  issueId: 'PAN-3286',
  runId: 'agent-pan-3286',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

const status: MemoryStatus = {
  name: 'PAN-3286 workspace parity',
  headline: 'Session-start briefing is being wired through the memory hook.',
  summary: 'Composition reads local status, observations, and pins.',
  goal: 'Hand every fresh session a standing briefing.',
  phase: 'building',
  accomplished: ['timeline shipped'],
  decided: ['no LLM call on the hook path'],
  open: ['runtime boot test'],
  nextSteps: ['compose the briefing', 'boot-test the server'],
  confidence: 0.9,
  workingSet: ['src/lib/memory/session-briefing.ts'],
  tags: ['memory'],
};

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-16T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? null,
    narrative: 'narrative',
    summary: overrides.summary ?? 'summary',
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

beforeEach(() => {
  savedHome = { present: 'OVERDECK_HOME' in process.env, value: process.env.OVERDECK_HOME };
  tempHome = mkdtempSync(join(tmpdir(), 'pan-3286-session-briefing-'));
  process.env.OVERDECK_HOME = tempHome;
  transcriptPath = join(tempHome, 'session-1.jsonl');
  writeFileSync(transcriptPath, '{"type":"user"}\n', 'utf8');
});

afterEach(() => {
  if (savedHome.present) process.env.OVERDECK_HOME = savedHome.value;
  else delete process.env.OVERDECK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('composeSessionStartBriefing (PAN-3286 WI-6 FR-10, D-7)', () => {
  it('renders status headline, goal, phase, next steps, observations, and pinned-doc titles', async () => {
    const briefing = await composeSessionStartBriefing({
      identity,
      sessionId: 'session-1',
      loadStatus: async () => status,
      loadObservations: async () => [
        observation({ id: 'obs-1', timestamp: '2026-05-16T20:00:00.000Z', summary: 'earlier observation' }),
        observation({ id: 'obs-2', timestamp: '2026-05-16T21:00:00.000Z', actionStatus: 'claimed session-start-briefing' }),
      ],
      loadPinnedDocPaths: () => ['docs/WORKSPACES-AND-PROJECTS.md'],
    });

    expect(briefing).not.toBeNull();
    const context = briefing!.context;
    expect(context).toContain(`<${SESSION_BRIEFING_TAG}>`);
    expect(context).toContain(status.headline);
    expect(context).toContain('Goal: Hand every fresh session a standing briefing.');
    expect(context).toContain('Phase: building (confidence 0.9)');
    expect(context).toContain('Next steps: compose the briefing; boot-test the server');
    expect(context).toContain('claimed session-start-briefing');
    expect(context).toContain('- docs/WORKSPACES-AND-PROJECTS.md');
    // Newest observation first, so budget trimming drops the oldest.
    expect(context.indexOf('claimed session-start-briefing')).toBeLessThan(context.indexOf('earlier observation'));
    expect(briefing!.byteSize).toBe(Buffer.byteLength(context, 'utf8'));
  });

  it('keeps each section inside SESSION_START_MEMORY_BUDGETS', async () => {
    const briefing = await composeSessionStartBriefing({
      identity,
      sessionId: 'session-1',
      loadStatus: async () => ({ ...status, headline: 'h'.repeat(5000) }),
      loadObservations: async () => Array.from({ length: 40 }, (_unused, index) => observation({
        id: `obs-${index}`,
        timestamp: '2026-05-16T20:00:00.000Z',
        summary: 's'.repeat(400),
      })),
      loadPinnedDocPaths: () => Array.from({ length: 200 }, (_unused, index) => `docs/pinned-${index}.md`),
    });

    const context = briefing!.context;
    const section = (heading: string): string => {
      const start = context.indexOf(heading);
      const rest = context.slice(start);
      const end = rest.indexOf('\n## ', 1);
      return end === -1 ? rest.slice(0, rest.indexOf(`</${SESSION_BRIEFING_TAG}>`)) : rest.slice(0, end);
    };

    expect(Buffer.byteLength(section('## Current status'), 'utf8')).toBeLessThanOrEqual(SESSION_START_MEMORY_BUDGETS.status);
    expect(Buffer.byteLength(section('## Recent observations'), 'utf8')).toBeLessThanOrEqual(SESSION_START_MEMORY_BUDGETS.observations + 8);
    expect(Buffer.byteLength(section('## Pinned docs'), 'utf8')).toBeLessThanOrEqual(SESSION_START_MEMORY_BUDGETS.pinnedDocs + 8);
  });

  it('returns null when there is no status, no observation, and no pin', async () => {
    const briefing = await composeSessionStartBriefing({
      identity,
      sessionId: 'session-1',
      loadStatus: async () => undefined,
      loadObservations: async () => [],
      loadPinnedDocPaths: () => [],
    });

    expect(briefing).toBeNull();
  });

  it('performs no LLM call and reads only local files', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('fetch must not be called while composing a SessionStart briefing');
    }) as never);

    const briefing = await composeSessionStartBriefing({
      identity,
      sessionId: 'session-1',
      loadStatus: async () => status,
      loadObservations: async () => [],
      loadPinnedDocPaths: () => [],
    });

    expect(briefing).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('session briefing dedup marker (PAN-3286 WI-6 FR-10)', () => {
  it('claims a session id once and refuses the second claim', async () => {
    const now = new Date('2026-05-16T20:00:00.000Z');

    expect(await claimSessionBriefing({ identity, sessionId: 'session-1', now })).toBe(true);
    expect(await claimSessionBriefing({ identity, sessionId: 'session-1', now })).toBe(false);
    expect(await claimSessionBriefing({ identity, sessionId: 'session-2', now })).toBe(true);
  });
});

describe('handleMemorySessionStartBody briefing delivery (PAN-3286 WI-6 FR-10)', () => {
  const body = () => ({
    session_id: 'session-1',
    transcript_path: transcriptPath,
    identity,
  });

  const baseOptions = () => ({
    areObservationsEnabled: async () => true,
    recordBriefingSessionStart: async () => {},
    resolveTranscriptPath: async () => transcriptPath,
    resolveIdentity: async () => identity,
    registerTranscript: () => {},
    now: new Date('2026-05-16T20:00:00.000Z'),
  });

  it('returns the briefing on a fresh session and nothing on the second SessionStart', async () => {
    const options = {
      ...baseOptions(),
      composeSessionStartBriefing: async () => ({ context: '<briefing>hi</briefing>', byteSize: 22 }),
    };

    const first = await handleMemorySessionStartBody(body(), options);
    const second = await handleMemorySessionStartBody(body(), options);

    expect(first).toEqual({ status: 'accepted', sessionId: 'session-1', briefing: '<briefing>hi</briefing>' });
    expect(second).toEqual({ status: 'accepted', sessionId: 'session-1' });
    expect(await readSessionBriefingMarker({
      identity,
      sessionId: 'session-1',
      now: new Date('2026-05-16T20:00:00.000Z'),
    })).toMatchObject({ sessionId: 'session-1', byteSize: 22 });
  });

  // Review fix: SessionStart legitimately fires before the harness writes the
  // transcript's first line, and that is exactly a fresh session — the case that
  // most needs the briefing. ENOENT must skip poller registration only.
  it('still returns the briefing when the transcript does not exist yet', async () => {
    const registerTranscript = vi.fn();

    const result = await handleMemorySessionStartBody(body(), {
      ...baseOptions(),
      registerTranscript,
      statTranscript: async () => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      },
      composeSessionStartBriefing: async () => ({ context: '<briefing>fresh</briefing>', byteSize: 25 }),
    });

    expect(result).toEqual({
      status: 'transcript-missing',
      sessionId: 'session-1',
      briefing: '<briefing>fresh</briefing>',
    });
    // The transcript is not registered for polling — that part is genuinely skipped.
    expect(registerTranscript).not.toHaveBeenCalled();
  });

  it('keeps transcript-missing briefing-less when the session was already briefed', async () => {
    const options = {
      ...baseOptions(),
      statTranscript: async () => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      },
      composeSessionStartBriefing: async () => ({ context: '<briefing>fresh</briefing>', byteSize: 25 }),
    };

    await handleMemorySessionStartBody(body(), options);
    const second = await handleMemorySessionStartBody(body(), options);

    expect(second).toEqual({ status: 'transcript-missing', sessionId: 'session-1' });
  });

  it('degrades to the plain accepted response when composition throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await handleMemorySessionStartBody(body(), {
      ...baseOptions(),
      composeSessionStartBriefing: async () => {
        throw new Error('composition exploded');
      },
    });

    expect(result).toEqual({ status: 'accepted', sessionId: 'session-1' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('degrades to the plain accepted response when there is nothing to brief', async () => {
    const result = await handleMemorySessionStartBody(body(), {
      ...baseOptions(),
      composeSessionStartBriefing: async () => null,
    });

    expect(result).toEqual({ status: 'accepted', sessionId: 'session-1' });
  });

  it('returns disabled unchanged when memory observations are off, without claiming the session', async () => {
    const claimSpy = vi.fn(async () => true);

    const result = await handleMemorySessionStartBody(body(), {
      ...baseOptions(),
      areObservationsEnabled: async () => false,
      claimSessionBriefing: claimSpy,
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(claimSpy).not.toHaveBeenCalled();
  });
});
