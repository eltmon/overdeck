/**
 * PAN-4341: the plan critique step in `pan plan finalize`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCritiqueStep, type CritiqueStepDeps } from '../../../src/cli/commands/plan-finalize.js';
import type { AgentState } from '../../../src/lib/agents/agent-state-read.js';
import { parseCritique, type CritiqueGateInput } from '../../../src/lib/planning/plan-critique.js';

const DIGEST = 'c'.repeat(64);
const DOC = { plan: { id: 'PAN-9', title: 'Fixture', items: [] } };
const INPUT = { issueId: 'PAN-9', workspacePath: '/ws/feature-pan-9', doc: DOC, forced: false, json: false };
const PRD = '/ws/feature-pan-9/.pan/drafts/PAN-9.md';

function gateInput(overrides: Partial<CritiqueGateInput> = {}): CritiqueGateInput {
  return { required: true, currentDigest: DIGEST, roundsUsed: 0, latest: null, prdText: '# PRD\n', ...overrides };
}

function critiqueRound1(body: string): CritiqueGateInput['latest'] {
  return { round: 1, critique: parseCritique(`plan-digest: ${DIGEST}\n\n${body}`) };
}

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function deps(overrides: Partial<CritiqueStepDeps> = {}) {
  return {
    isPlanFlagged: vi.fn(async () => true),
    loadCritiqueGateInput: vi.fn(async () => ({ gateInput: gateInput(), prdPath: PRD })),
    resolvePlanCritic: vi.fn(async () => ({ ok: true as const, model: 'gpt-5.6-sol', harness: 'codex' as const, family: 'gpt', plannerFamily: 'claude' })),
    dispatchPlanCritic: vi.fn(async () => ({ kind: 'written' as const, path: `${PRD}-critique.md`, workerId: 'agent-pan-9-worker-1' })),
    getAgentState: vi.fn(() => ({ model: 'claude-opus-4-8' }) as AgentState),
    loadConfig: vi.fn(() => ({ roles: {}, workhorses: {} }) as never),
    env: {},
    exit: vi.fn(async (code: number): Promise<never> => {
      throw new ExitCalled(code);
    }),
    ...overrides,
  } satisfies CritiqueStepDeps;
}

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function printed(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('runCritiqueStep', () => {
  it('proceeds without a critic for an unflagged plan', async () => {
    const d = deps({ isPlanFlagged: vi.fn(async () => false) });
    expect(await runCritiqueStep(INPUT, d)).toEqual({ proceed: true, required: false });
    expect(d.loadCritiqueGateInput).not.toHaveBeenCalled();
    expect(d.dispatchPlanCritic).not.toHaveBeenCalled();
  });

  it('dispatches round 1 for a flagged plan without a critique, then proceeds on a non-blocking critique', async () => {
    const loadCritiqueGateInput = vi
      .fn()
      .mockResolvedValueOnce({ gateInput: gateInput(), prdPath: PRD })
      .mockResolvedValueOnce({ gateInput: gateInput({ roundsUsed: 1, latest: critiqueRound1('## footnote: fine\n') }), prdPath: PRD });
    const d = deps({ loadCritiqueGateInput });

    expect(await runCritiqueStep(INPUT, d)).toEqual({ proceed: true, required: true });
    expect(d.dispatchPlanCritic).toHaveBeenCalledWith(
      expect.objectContaining({ round: 1, prdPath: PRD, doc: DOC, parentId: 'planning-pan-9' }),
    );
    expect(d.resolvePlanCritic).toHaveBeenCalledWith(expect.objectContaining({ plannerModel: 'claude-opus-4-8' }));
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('exits 5 naming an unanswered blocks-the-design finding', async () => {
    const d = deps({
      loadCritiqueGateInput: vi.fn(async () => ({
        gateInput: gateInput({ roundsUsed: 1, latest: critiqueRound1('## blocks-the-design: Missing rollback\n') }),
        prdPath: PRD,
      })),
    });

    await expect(runCritiqueStep(INPUT, d)).rejects.toThrow('exit 5');
    expect(d.dispatchPlanCritic).not.toHaveBeenCalled();
    expect(printed(stderr)).toContain('Missing rollback');
  });

  it('exits 5 naming roles.plan.sub.critic.model when the critic is not configured', async () => {
    const d = deps({
      resolvePlanCritic: vi.fn(async () => ({
        ok: false as const,
        reason: 'critic-not-configured' as const,
        message: 'Plan critic not configured: set roles.plan.sub.critic.model in ~/.overdeck/config.yaml',
      })),
    });

    await expect(runCritiqueStep(INPUT, d)).rejects.toThrow('exit 5');
    expect(d.dispatchPlanCritic).not.toHaveBeenCalled();
    expect(printed(stderr)).toContain('roles.plan.sub.critic.model');
  });

  it('prints the JSON refusal on stdout with --json', async () => {
    const d = deps({
      dispatchPlanCritic: vi.fn(async () => ({ kind: 'running' as const, workerId: 'agent-pan-9-worker-1', message: 'critic still running' })),
    });

    await expect(runCritiqueStep({ ...INPUT, json: true }, d)).rejects.toThrow('exit 5');
    const payload = JSON.parse(printed(stdout));
    expect(payload).toMatchObject({ success: false, error: 'Plan critique gate failed', message: 'critic still running' });
    expect(payload.critiqueGate).toMatchObject({ kind: 'missing', nextRound: 1 });
  });

  it('refuses a flagged plan without a workspace PRD', async () => {
    const d = deps({ loadCritiqueGateInput: vi.fn(async () => ({ gateInput: gateInput({ prdText: null }), prdPath: null })) });
    await expect(runCritiqueStep(INPUT, d)).rejects.toThrow('exit 5');
    expect(printed(stderr)).toContain('.pan/drafts/PAN-9.md');
  });
});
