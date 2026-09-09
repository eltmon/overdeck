import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('managed Kimi launch wiring', () => {
  it('captures specialist identity before shared prompt delivery and covers empty prompts', () => {
    const source = readFileSync(resolve('src/lib/agents/spawn.ts'), 'utf8');
    const capture = source.indexOf('rawSessionId = await launchAndCaptureManagedKimiSession({');
    const delivery = source.indexOf("deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt')", capture);

    expect(capture).toBeGreaterThan(-1);
    expect(delivery).toBeGreaterThan(capture);
    expect(source.match(/launchAndCaptureManagedKimiSession\(\{/g)).toHaveLength(2);
    expect(source.match(/prompt \|\| resolvedHarness === 'kimi-code'/g)).toHaveLength(2);
    expect(source).toContain('resumeSessionId: options.resumeSessionId');
  });

  it('makes failed Kimi delivery fatal in both flywheel spawnRun and knowledge spawnAgent paths', () => {
    const source = readFileSync(resolve('src/lib/agents/spawn.ts'), 'utf8');

    expect(source.match(/await requireManagedKimiDelivery\(\{/g)).toHaveLength(2);
    expect(source).toMatch(
      /tracksKickoffDelivery[\s\S]*?deliverInitialPromptWithRetry\(agentId, prompt, 'spawnRun:initial-prompt'\)[\s\S]*?requireManagedKimiDelivery\([\s\S]*?stopAgent\(agentId\)/,
    );
    expect(source).toMatch(
      /deliverInitialPromptWithRetry\(agentId, prompt, 'spawnAgent:initial-prompt'[\s\S]*?requireManagedKimiDelivery\([\s\S]*?stopAgent\(agentId\)/,
    );
  });

  it('captures planning identity before shared kickoff delivery', () => {
    const source = readFileSync(resolve('src/lib/planning/spawn-planning-session.ts'), 'utf8');
    const capture = source.indexOf('await launchAndCaptureManagedKimiSession({');
    const delivery = source.indexOf('const delivery = await deliverInitialPromptWithRetry(', capture);

    expect(capture).toBeGreaterThan(-1);
    expect(delivery).toBeGreaterThan(capture);
  });

  it('delivers mandatory Kimi resume context before optional prose and active state', () => {
    const source = readFileSync(resolve('src/lib/overdeck/conversation-runtime.ts'), 'utf8');
    const mandatory = source.indexOf('await deliverMandatoryKimiResumeContext(');
    const optional = source.indexOf('const resumeContractResult = await deliverResumeContractUnlessGated(', mandatory);
    const asserted = source.indexOf('assertKimiResumeContractResult(resumeContractResult)', optional);
    const active = source.indexOf('markConversationActive(name);', asserted);

    expect(mandatory).toBeGreaterThan(-1);
    expect(optional).toBeGreaterThan(mandatory);
    expect(asserted).toBeGreaterThan(optional);
    expect(active).toBeGreaterThan(asserted);
  });
});
