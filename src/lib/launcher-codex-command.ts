/**
 * Codex command-line construction for the launcher generator (PAN-3300).
 *
 * Extracted from launcher-generator.ts (file-size ceiling): every `codex` and
 * codex-app-server invocation shape lives here. The generator passes the
 * LauncherConfig fields these shapes read plus its own PTY-supervisor wrapper,
 * so this module stays a leaf — it never imports back into the generator.
 */
import { join } from 'node:path';
import { toCodexSandboxValue } from './runtimes/codex.js';
import { shellQuoteModelIdSync } from './model-validation.js';
import { packageRoot } from './paths.js';
import { shellQuote } from './shell-quote.js';

/** The LauncherConfig subset the Codex command shapes read. */
export interface CodexCommandConfig {
  codexMode?: 'exec' | 'tui' | 'work-tui' | 'app-server';
  codexSandboxMode?: string;
  resumeSessionId?: string;
  model?: string;
  promptFile?: string;
  promptInline?: string;
  overdeckEnv?: { agentId?: string };
}

/** Wrap a command in the PTY supervisor (no-op when the launcher isn't using it). */
export type SupervisorWrap = (cmd: string) => string;

export function buildCodexCommand(
  config: CodexCommandConfig,
  useExec: boolean,
  wrap: SupervisorWrap,
): string[] {
  const cmd = computeCodexCommandTokens(config, useExec, wrap);
  // PAN-1988 — log the resolved codex invocation so a "resume started over instead of continuing"
  // regression is one `grep '[codex-launcher]'` away: it shows the mode, the resume id we were
  // handed, and whether `resume <id>` actually made it into the command for that mode. This is the
  // log that would have caught the work-tui branch silently dropping resumeSessionId.
  const flat = cmd.join(' ').replace(/\s+/g, ' ');
  const applied = /(^|\s)resume(\s|$)/.test(flat) ? 'YES' : 'no';
  console.log(
    `[codex-launcher] agent=${config.overdeckEnv?.agentId ?? '?'} mode=${config.codexMode ?? 'exec'} ` +
    `resumeSessionId=${config.resumeSessionId ?? '(none)'} resumeApplied=${applied} cmd=${flat.slice(0, 200)}`,
  );
  return cmd;
}

function computeCodexCommandTokens(
  config: CodexCommandConfig,
  useExec: boolean,
  wrap: SupervisorWrap,
): string[] {
  const codexMode = config.codexMode ?? 'exec';

  // TUI / conversation mode: interactive terminal, optionally under the PTY
  // supervisor for conversation delivery. Keep CODEX_HOME/AGENTS.md, but do
  // not let repo AGENTS.md turn a normal dashboard conversation into a work
  // agent with project-level task-tracker rules.
  if (codexMode === 'tui') {
    const tokens: string[] = ['codex'];
    if (config.resumeSessionId) {
      tokens.push('resume');
    }
    tokens.push('-c', 'project_doc_max_bytes=0');
    if (config.resumeSessionId) {
      tokens.push(shellQuote(config.resumeSessionId));
    }
    const cmd = wrap(tokens.join(' '));
    return [useExec ? `exec ${cmd}` : cmd];
  }

  if (codexMode === 'work-tui') {
    // PAN-1803: approval_policy and sandbox_mode come from the per-agent
    // config.toml that initCodexHome seeds from the user's Settings →
    // Permissions → Codex level (getCodexLauncherFields). Do NOT pass `-s` or
    // `-c approval_policy=` on the CLI — those override config.toml and would
    // ignore the Settings choice. Mirror the conversation path (codexMode
    // 'tui'), which relies entirely on the seeded config.toml. Only `-m`
    // (per-agent model) is passed here.
    const tokens: string[] = ['codex'];
    // PAN-1988: apply the resume id so a re-dispatched work/review agent CONTINUES its codex thread
    // (keeping the prior round's context) instead of opening a fresh TUI session. `codex resume
    // <id>` mirrors the 'tui' branch — the bug was that work-tui dropped resumeSessionId entirely,
    // so every re-review started over and re-researched the whole diff.
    if (config.resumeSessionId) {
      tokens.push('resume');
    }
    if (config.model) {
      tokens.push('-m', shellQuoteModelIdSync(config.model));
    }
    if (config.resumeSessionId) {
      tokens.push(shellQuote(config.resumeSessionId));
    }
    const cmd = wrap(tokens.join(' '));
    return [useExec ? `exec ${cmd}` : cmd];
  }

  if (codexMode === 'app-server') {
    const hostPath = join(packageRoot, 'dist', 'codex-app-server-host.js');
    const tokens: string[] = ['node', shellQuote(hostPath)];
    if (config.model) {
      tokens.push('--model', shellQuoteModelIdSync(config.model));
    }
    if (config.resumeSessionId) {
      tokens.push('--resume', shellQuote(config.resumeSessionId));
    }
    const cmd = tokens.join(' ');
    return [useExec ? `exec ${cmd}` : cmd];
  }

  const isResume = Boolean(config.resumeSessionId);

  // Headless exec mode — fresh spawn or resume.
  // Resume: `codex exec resume <threadId> [prompt]`
  //   Note: `codex exec resume` rejects -s; sandbox must be set via -c.
  // Fresh: `codex exec [-m model] -c approval_policy=never -s sandbox --skip-git-repo-check [prompt]`
  const tokens: string[] = ['codex', 'exec'];
  if (isResume) {
    tokens.push('resume');
  }

  if (config.model) {
    tokens.push('-m', shellQuoteModelIdSync(config.model));
  }

  // Disable approval prompts (codex exec rejects --ask-for-approval; use -c instead)
  tokens.push('-c', 'approval_policy=never');

  // Sandbox mode: translate Overdeck's abstract 'workspace' token to the
  // codex CLI's 'workspace-write' (PAN-1799 — raw 'workspace' is rejected and
  // the agent dies at boot). Resume path uses -c (not -s) because
  // `codex exec resume` rejects -s.
  const sandbox = toCodexSandboxValue(config.codexSandboxMode);
  if (isResume) {
    tokens.push('-c', `sandbox_mode=${sandbox}`);
  } else {
    tokens.push('-s', sandbox);
  }

  tokens.push('--skip-git-repo-check');

  if (isResume) {
    tokens.push(shellQuote(config.resumeSessionId!));
  }

  if (config.promptFile) {
    tokens.push('"$prompt"');
  } else if (config.promptInline) {
    tokens.push(shellQuote(config.promptInline));
  }

  const cmd = tokens.join(' ').replace(/\s+/g, ' ').trim();
  return [useExec ? `exec ${cmd}` : cmd];
}
