import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// isTurnEndAssessmentEnabled() (the real gate peekTurnEndAssessment always consults)
// resolves config through loadConfigSync(); mock it so the gate is open by default
// regardless of the host's real config, and closed only where a test asks for it.
const configMock = vi.hoisted(() => ({ loadConfigSync: vi.fn() }));
vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return { ...actual, loadConfigSync: configMock.loadConfigSync };
});

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV } from '../../config-yaml/jev.js';
import {
  clearTurnEndAssessment,
  peekTurnEndAssessment,
  resetTurnEndStore,
  scheduleTurnEndAssessment,
  TURN_END_STORE_MAX_ENTRIES,
  type TurnEndStoreDeps,
} from '../turn-end-store.js';
import type { TurnEndAssessment, TurnEndOutcome } from '../turn-end.js';
import type { LastAssistantMessage } from '../../agents/last-assistant-message.js';

const AGENT = 'agent-1';
const ROLE = 'work';

function enabledConfig() {
  return {
    config: {
      backgroundAi: { cheapMode: false, features: { ...defaultBackgroundAiFeatures(), jevTurnEndAssessment: true } },
      jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x' },
      apiKeys: { typesafe: 'k' },
    },
  };
}

function deps(overrides: Partial<TurnEndStoreDeps> = {}): TurnEndStoreDeps {
  return {
    isEnabled: () => true,
    resolveWorkspace: vi.fn(async () => '/tmp/ws'),
    readLastAssistantMessage: vi.fn(async (): Promise<LastAssistantMessage> => ({
      ok: true,
      messageId: 'm1',
      text: 'hello',
      transcriptKind: 'claude',
    })),
    assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({
      status: 'assessed',
      assessment: { kind: 'asks_operator', confidence: 0.9, needsAnswer: true, model: 'm' },
    })),
    ...overrides,
  };
}

beforeEach(() => {
  configMock.loadConfigSync.mockReturnValue(enabledConfig());
  resetTurnEndStore();
});

afterEach(() => {
  resetTurnEndStore();
});

describe('scheduleTurnEndAssessment / peekTurnEndAssessment (PAN-4371)', () => {
  it('ac1: gate closed — readLastAssistantMessage is never called and peek returns undefined', async () => {
    const d = deps({ isEnabled: () => false });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    expect(d.readLastAssistantMessage).not.toHaveBeenCalled();
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();
  });

  it('ac2: after a completed schedule, peek at the same mtime returns the view and a different mtime returns undefined', async () => {
    const view: TurnEndAssessment = { kind: 'asks_operator', confidence: 0.9, needsAnswer: true, model: 'm' };
    const d = deps({
      assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({ status: 'assessed', assessment: view })),
    });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await vi.waitFor(() => expect(peekTurnEndAssessment(AGENT, 100)).toEqual(view));
    expect(peekTurnEndAssessment(AGENT, 200)).toBeUndefined();
  });

  it('ac3: a below-threshold outcome stores a marker — peek returns undefined and a second schedule makes no second assessTurnEnd call', async () => {
    const d = deps({
      assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({
        status: 'assessed',
        assessment: { kind: 'other', confidence: 0.1, needsAnswer: false, model: 'm' },
      })),
    });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await vi.waitFor(() => expect(d.assessTurnEnd).toHaveBeenCalledTimes(1));
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();

    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    expect(d.assessTurnEnd).toHaveBeenCalledTimes(1);
  });

  it('ac4: a never-resolving readLastAssistantMessage returns synchronously and a second schedule for the same mtime makes no second read call', async () => {
    const neverResolves = vi.fn(() => new Promise<LastAssistantMessage>(() => {}));
    const d = deps({ readLastAssistantMessage: neverResolves });
    const returnValue = scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    expect(returnValue).toBeUndefined();
    await vi.waitFor(() => expect(neverResolves).toHaveBeenCalledTimes(1));
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(neverResolves).toHaveBeenCalledTimes(1);
  });

  it('mtime null never reads and never stores', () => {
    const d = deps();
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: null }, d);
    expect(d.readLastAssistantMessage).not.toHaveBeenCalled();
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();
  });

  it('an unavailable transcript stores a no-transcript marker without calling assessTurnEnd', async () => {
    const d = deps({
      readLastAssistantMessage: vi.fn(async (): Promise<LastAssistantMessage> => ({ ok: false, reason: 'no-transcript' })),
    });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await vi.waitFor(() => expect(d.readLastAssistantMessage).toHaveBeenCalledTimes(1));
    expect(d.assessTurnEnd).not.toHaveBeenCalled();
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();
  });

  it('clearTurnEndAssessment removes the entry', async () => {
    const view: TurnEndAssessment = { kind: 'reports_complete', confidence: 0.9, needsAnswer: false, model: 'm' };
    const d = deps({
      assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({ status: 'assessed', assessment: view })),
    });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await vi.waitFor(() => expect(peekTurnEndAssessment(AGENT, 100)).toEqual(view));
    clearTurnEndAssessment(AGENT);
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();
  });

  it('caps the store at TURN_END_STORE_MAX_ENTRIES, evicting the oldest entry', async () => {
    const view: TurnEndAssessment = { kind: 'reports_complete', confidence: 0.9, needsAnswer: false, model: 'm' };
    const d = deps({
      assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({ status: 'assessed', assessment: view })),
    });
    for (let i = 0; i < TURN_END_STORE_MAX_ENTRIES + 1; i += 1) {
      scheduleTurnEndAssessment({ agentId: `agent-${i}`, role: ROLE, transcriptMtime: 100 }, d);
    }
    await vi.waitFor(() => expect(peekTurnEndAssessment(`agent-${TURN_END_STORE_MAX_ENTRIES}`, 100)).toEqual(view));
    expect(peekTurnEndAssessment('agent-0', 100)).toBeUndefined();
  });

  it('peek itself is gated — closing the feature after a stored entry hides it', async () => {
    const view: TurnEndAssessment = { kind: 'reports_complete', confidence: 0.9, needsAnswer: false, model: 'm' };
    const d = deps({
      assessTurnEnd: vi.fn(async (): Promise<TurnEndOutcome> => ({ status: 'assessed', assessment: view })),
    });
    scheduleTurnEndAssessment({ agentId: AGENT, role: ROLE, transcriptMtime: 100 }, d);
    await vi.waitFor(() => expect(peekTurnEndAssessment(AGENT, 100)).toEqual(view));
    configMock.loadConfigSync.mockReturnValue({
      config: { ...enabledConfig().config, backgroundAi: { cheapMode: true, features: defaultBackgroundAiFeatures() } },
    });
    expect(peekTurnEndAssessment(AGENT, 100)).toBeUndefined();
  });
});
