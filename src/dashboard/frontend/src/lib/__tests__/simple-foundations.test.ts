/**
 * PAN-2908 · C-VOCAB + C-SIMPLE foundations tests.
 *
 * - phases.ts: exhaustive rail projection over every PipelineState
 * - userFacingState.ts: five-state projection + signal overrides + one-button rule
 * - strings.ts: banned-words copy lint over the simple-mode catalogs
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PHASES, phaseLabel, phaseRailState, currentPhase, simpleStepIndex, type PhaseRailState } from '../simple/phases';
import { USER_FACING_STATES, userFacingState, userFacingDisplay } from '../simple/userFacingState';
import type { PipelineState } from '../issuePipelineState';
import { BANNED_WORDS, findBannedWords, SIMPLE_STRINGS } from '../simple/strings';

const ALL_PIPELINE_STATES: PipelineState[] = [
  'planning_active',
  'planning_done_awaiting_work',
  'in_progress_work_running',
  'in_progress_work_idle',
  'verification_failing',
  'in_review_reviewers_running',
  'in_review_changes_requested',
  'in_review_approved',
  'testing_running',
  'testing_failures',
  'ready_to_merge',
  'merging',
  'verifying',
  'merged',
  'done',
  'canceled',
  'generic',
];

describe('PHASES vocabulary (C-VOCAB)', () => {
  it('has exactly six phases in lifecycle order', () => {
    expect([...PHASES]).toEqual(['plan', 'work', 'review', 'test', 'ship', 'done']);
  });

  it('labels are the six words, nothing else', () => {
    expect(PHASES.map(phaseLabel)).toEqual(['Plan', 'Work', 'Review', 'Test', 'Ship', 'Done']);
  });

  it('every PipelineState projects onto the rail (exhaustive)', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      const rail: PhaseRailState = phaseRailState(ps);
      for (const phase of PHASES) {
        expect(['done', 'current', 'pending', 'attention']).toContain(rail[phase]);
      }
    }
  });

  it('every PipelineState projects onto a four-step index (exhaustive)', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      const i = simpleStepIndex(ps);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(4);
    }
  });

  /**
   * PAN-3330 — the track used to be indexed by user-facing state, which pinned
   * every needs-you to step 1 ("Writing code"). Nothing before the work phase
   * may claim code is being written.
   */
  it('no pre-work state lands on the "Writing code" step', () => {
    const steps = SIMPLE_STRINGS.issue.steps;
    expect(steps[1]).toBe('Writing code');
    for (const ps of ['planning_active', 'planning_done_awaiting_work'] as PipelineState[]) {
      expect(simpleStepIndex(ps)).toBe(0);
    }
  });

  it('rail is monotonic: no "done" phase after a "pending" phase', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      if (ps === 'canceled' || ps === 'generic') continue;
      const rail = phaseRailState(ps);
      let seenPending = false;
      for (const phase of PHASES) {
        if (rail[phase] === 'pending') seenPending = true;
        if (seenPending) expect(rail[phase]).toBe('pending');
      }
    }
  });

  it('currentPhase finds the live step for active states', () => {
    expect(currentPhase('in_progress_work_running')).toBe('work');
    expect(currentPhase('in_review_changes_requested')).toBe('review');
    expect(currentPhase('ready_to_merge')).toBe('ship');
    expect(currentPhase('generic')).toBeNull();
  });
});

describe('userFacingState (C-SIMPLE)', () => {
  it('has exactly five states', () => {
    expect([...USER_FACING_STATES]).toEqual(['not-started', 'working', 'needs-you', 'ready', 'done']);
  });

  it('every PipelineState maps to a user-facing state (exhaustive)', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      expect(USER_FACING_STATES).toContain(userFacingState({ pipelineState: ps }));
    }
  });

  it('pending input and stuck always win (needs-you)', () => {
    expect(userFacingState({ pipelineState: 'in_progress_work_running', pendingInput: true })).toBe('needs-you');
    expect(userFacingState({ pipelineState: 'ready_to_merge', pendingInput: true })).toBe('needs-you');
    expect(userFacingState({ pipelineState: 'in_review_reviewers_running', stuck: true })).toBe('needs-you');
  });

  it('one-button rule: at most one primary action per display', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      const d = userFacingDisplay({ pipelineState: ps });
      expect(Array.isArray(d.secondaryActions)).toBe(true);
      expect(d.secondaryActions.length).toBeLessThanOrEqual(2);
      // primaryAction is a single string or null by construction
      expect(d.primaryAction === null || typeof d.primaryAction === 'string').toBe(true);
    }
    expect(userFacingDisplay({ pipelineState: 'ready_to_merge' }).primaryAction).toBe('Merge to main');
    expect(userFacingDisplay({ pipelineState: 'generic' }).primaryAction).toBe('Start work');
  });
});

describe('simple-mode copy lint (C-SIMPLE §3.1.6)', () => {
  const flatten = (v: unknown): string[] => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(flatten);
    if (v && typeof v === 'object') return Object.values(v).flatMap(flatten);
    return [];
  };

  it('the string catalog contains no banned words', () => {
    for (const s of flatten(SIMPLE_STRINGS)) {
      expect(findBannedWords(s), `banned word in: "${s}"`).toEqual([]);
    }
  });

  it('user-facing display strings contain no banned words', () => {
    for (const ps of ALL_PIPELINE_STATES) {
      const d = userFacingDisplay({ pipelineState: ps });
      for (const s of [d.title, d.sentence, d.primaryAction ?? '', ...d.secondaryActions]) {
        expect(findBannedWords(s), `banned word in "${s}" (${ps})`).toEqual([]);
      }
    }
    for (const d of [userFacingDisplay({ pipelineState: 'generic', pendingInput: true }), userFacingDisplay({ pipelineState: 'generic', stuck: true })]) {
      for (const s of [d.title, d.sentence, d.primaryAction ?? '']) {
        expect(findBannedWords(s), `banned word in "${s}"`).toEqual([]);
      }
    }
  });

  it('simple components source contains no banned words', () => {
    const dir = join(__dirname, '../../components/simple');
    if (!existsSync(dir)) return; // components land in a later slice; lint activates with them
    const files = readdirSync(dir).filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'));
    // User-facing copy only: quoted string contents + JSX text nodes. Prop and
    // identifier names (e.g. onHarnessChange) are API vocabulary, not copy.
    const extractCopy = (src: string): string[] => {
      const out: string[] = [];
      for (const m of src.matchAll(/['"`]([^'"`\n]{2,})['"`]/g)) out.push(m[1]);
      return out;
    };
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const copy of extractCopy(src)) {
        for (const re of BANNED_WORDS) {
          expect(re.test(copy), `banned word ${re.source} in components/simple/${f}: "${copy.slice(0, 60)}"`).toBe(false);
        }
      }
    }
  });
});
