import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateLauncherScript, type LauncherConfig } from '../../../src/lib/launcher-generator.js';

let tempHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-prime-launcher-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const PRIME_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
  harness: 'prime-agent',
  model: 'gpt-5.5',
  primeAgent: {
    agentId: 'agent-pan-3668',
    binaryPath: '/opt/prime agent/bin/prime-agent',
    provider: 'openai-codex',
    workspace: '/workspace/project',
    contextFile: '/home/user/.overdeck/agents/agent-pan-3668/prime-agent-context.md',
  },
  overdeckEnv: { agentId: 'agent-pan-3668' },
  unsetProviderEnv: true,
};

describe('generateLauncherScript — prime-agent (PAN-3668 WI-12)', () => {
  it('execs dist/prime-agent-host.js with every value shell-quoted and no --resume on a fresh launch', () => {
    const script = generateLauncherScript(PRIME_CONFIG);

    expect(script).toMatch(
      /^exec node '.+\/dist\/prime-agent-host\.js' --agent 'agent-pan-3668' --binary-path '\/opt\/prime agent\/bin\/prime-agent' --workspace '\/workspace\/project' --provider 'openai-codex' --model 'gpt-5\.5' --context-file '\/home\/user\/\.overdeck\/agents\/agent-pan-3668\/prime-agent-context\.md'$/m,
    );
    expect(script).not.toContain('--resume');
    expect(script).not.toContain('--append-system-prompt-file');
    expect(script).not.toContain('initial-prompt');
  });

  it('adds --thinking and --resume only when they are set', () => {
    const script = generateLauncherScript({
      ...PRIME_CONFIG,
      primeAgent: {
        ...PRIME_CONFIG.primeAgent!,
        thinking: 'high',
        resumeSessionFile: '/home/user/.overdeck/agents/agent-pan-3668/prime-sessions/0a1b.jsonl',
      },
    });

    expect(script).toMatch(/ --thinking 'high' --resume '\/home\/user\/\.overdeck\/agents\/agent-pan-3668\/prime-sessions\/0a1b\.jsonl'$/m);
  });

  it('runs without exec for a conversation pane', () => {
    const script = generateLauncherScript({ ...PRIME_CONFIG, spawnMode: 'conversation' });
    expect(script).toMatch(/^node '.+\/dist\/prime-agent-host\.js' --agent 'agent-pan-3668'/m);
  });

  it('unsets stale provider env except the credential name the pane env carries, and writes no secret', () => {
    const script = generateLauncherScript({ ...PRIME_CONFIG, preserveProviderEnv: ['OPENAI_API_KEY'] });

    expect(script).toContain('unset ANTHROPIC_API_KEY');
    expect(script).toContain('unset ANTHROPIC_BASE_URL');
    expect(script).not.toContain('unset OPENAI_API_KEY');
    expect(script).not.toMatch(/export (?:OPENAI|ANTHROPIC|GEMINI|KIMI)_API_KEY=/);
  });

  it('records the prime-agent context file in the launch receipt', () => {
    const script = generateLauncherScript(PRIME_CONFIG);
    expect(script).toContain("'prime-agent-append-system-prompt'");
    expect(script).toContain("'/home/user/.overdeck/agents/agent-pan-3668/prime-agent-context.md'");
  });

  it('refuses a launch without the primeAgent fields', () => {
    expect(() => generateLauncherScript({ ...PRIME_CONFIG, primeAgent: undefined })).toThrow('prime-agent launcher requires primeAgent fields');
  });
});
