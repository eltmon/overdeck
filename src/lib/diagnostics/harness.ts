/**
 * Harness eligibility and launch argv for `pan diagnose` (PAN-4643 FR-14, D3, D4, D10).
 *
 * Eligible = installed on `PATH` and authenticated. `buildHarnessLaunch`
 * never emits a permission-bypass flag (`--dangerously-*`, `--full-auto`,
 * `-s danger-full-access`), `-p`/`exec`, or `--model` — the operator
 * approves the model's actions with the harness's own default approval mode.
 */

import { execFile as execFileCb } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { classifyNativeCodexAuth, getNativeCodexAuthPath } from '../codex-auth.js';
import { checkClaudeLogin } from '../first-run-checks.js';

const execFileAsync = promisify(execFileCb);

export type DiagnoseHarness = 'claude-code' | 'codex';

interface HarnessDefinition {
  harness: DiagnoseHarness;
  label: string;
  command: string;
  notInstalledFix: string;
  notSignedInFix: string;
  /** Per-harness capability: how to decide this harness is signed in. */
  checkAuthenticated: (deps: HarnessEligibilityDeps) => Promise<boolean>;
}

export const DIAGNOSE_HARNESSES: readonly HarnessDefinition[] = [
  {
    harness: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    notInstalledFix: 'Install: npm install -g @anthropic-ai/claude-code',
    notSignedInFix: 'Run: claude, then /login (or set ANTHROPIC_API_KEY)',
    checkAuthenticated: async (deps) => (await deps.claudeLogin()).ok,
  },
  {
    harness: 'codex',
    label: 'Codex',
    command: 'codex',
    notInstalledFix: 'Install: npm install -g @openai/codex',
    notSignedInFix: 'Run: codex login',
    checkAuthenticated: async (deps) => classifyNativeCodexAuth(await deps.readCodexAuth()).status === 'valid',
  },
];

function harnessDefinition(harness: DiagnoseHarness): HarnessDefinition {
  const definition = DIAGNOSE_HARNESSES.find((entry) => entry.harness === harness);
  if (!definition) throw new Error(`unknown diagnose harness: ${harness}`);
  return definition;
}

export interface HarnessEligibilityDeps {
  which: (command: string) => Promise<boolean>;
  claudeLogin: () => Promise<{ ok: boolean }>;
  readCodexAuth: () => Promise<string | null>;
}

async function defaultWhich(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadCodexAuth(): Promise<string | null> {
  const codexHome = process.env.CODEX_HOME;
  const authPath = codexHome ? join(codexHome, 'auth.json') : getNativeCodexAuthPath();
  try {
    return await readFile(authPath, 'utf-8');
  } catch {
    return null;
  }
}

const defaultDeps: HarnessEligibilityDeps = {
  which: defaultWhich,
  claudeLogin: checkClaudeLogin,
  readCodexAuth: defaultReadCodexAuth,
};

export interface HarnessEligibility {
  harness: DiagnoseHarness;
  label: string;
  installed: boolean;
  authenticated: boolean;
  eligible: boolean;
  reason: string | null;
  fix: string | null;
}

export async function checkHarnessEligibility(
  harness: DiagnoseHarness,
  deps: Partial<HarnessEligibilityDeps> = {},
): Promise<HarnessEligibility> {
  const resolved: HarnessEligibilityDeps = { ...defaultDeps, ...deps };
  const definition = harnessDefinition(harness);

  const installed = await resolved.which(definition.command);
  if (!installed) {
    return {
      harness,
      label: definition.label,
      installed: false,
      authenticated: false,
      eligible: false,
      reason: 'not installed',
      fix: definition.notInstalledFix,
    };
  }

  const authenticated = await definition.checkAuthenticated(resolved);
  if (!authenticated) {
    return {
      harness,
      label: definition.label,
      installed: true,
      authenticated: false,
      eligible: false,
      reason: 'not signed in',
      fix: definition.notSignedInFix,
    };
  }

  return {
    harness,
    label: definition.label,
    installed: true,
    authenticated: true,
    eligible: true,
    reason: null,
    fix: null,
  };
}

export async function listHarnessEligibility(deps: Partial<HarnessEligibilityDeps> = {}): Promise<HarnessEligibility[]> {
  return Promise.all(DIAGNOSE_HARNESSES.map((definition) => checkHarnessEligibility(definition.harness, deps)));
}

export interface HarnessLaunch {
  command: string;
  args: string[];
  cwd: string;
}

export function buildHarnessLaunch(harness: DiagnoseHarness, prompt: string, overdeckHome: string): HarnessLaunch {
  const definition = harnessDefinition(harness);
  return { command: definition.command, args: [prompt], cwd: overdeckHome };
}
