/**
 * Retro-agent spawn-run-exit lifecycle (PAN-709, bead 284)
 *
 * Spawns an ephemeral tmux session `retro-<issueId>`, launches Claude Code
 * with the retro-agent prompt, enforces a 5-minute hard cap via deacon,
 * and kills the session when done.
 *
 * This is NOT the long-lived specialist pattern. It's a one-shot agent:
 *   spawn → run → write retro file → exit → kill session
 */

import { writeFileSync, mkdirSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { PANOPTICON_HOME } from '../paths.js';
import { buildTmuxCommandString, killSessionAsync, sessionExistsAsync, sendKeysAsync } from '../tmux.js';
import { gatherRetroInputs } from '../flywheel/retro-inputs.js';
import { resolveProjectFromIssue } from '../projects.js';

const execAsync = promisify(exec);

/** Hard cap: 5 minutes in milliseconds. */
const RETRO_TIMEOUT_MS = 5 * 60 * 1000;

/** Model for retro-agent — Sonnet for quality retrospection. */
const RETRO_MODEL = 'claude-sonnet-4-6';

/** Env vars that must be unset to avoid provider conflicts. */
const PROVIDER_UNSET_LINES = `unset ANTHROPIC_API_KEY_TYPE || true
unset ANTHROPIC_PROVIDER || true`;

export interface RetroAgentResult {
  success: boolean;
  issueId: string;
  /** Path to the written retro file, if successful */
  retroFilePath?: string;
  /** Error message if the spawn failed or timed out */
  error?: string;
  timedOut?: boolean;
}

/**
 * Spawn retro-agent for a merged issue.
 *
 * Returns a promise that resolves after the retro completes or the 5-min cap fires.
 * Never throws — all errors are returned in the result object.
 */
export async function spawnRetroAgent(issueId: string): Promise<RetroAgentResult> {
  const sessionName = `retro-${issueId.toLowerCase()}`;
  const agentDir = join(PANOPTICON_HOME, 'agents', sessionName);
  const logFile = join(agentDir, 'retro.log');

  try {
    // Resolve workspace path for context
    const project = resolveProjectFromIssue(issueId);
    const cwd = project?.projectPath ?? process.cwd();

    // Gather bounded inputs
    const inputs = await gatherRetroInputs(issueId);

    // Build the retro prompt from the skill + inputs
    const promptFilePath = join(agentDir, 'retro-prompt.md');
    mkdirSync(agentDir, { recursive: true });
    const retroPrompt = buildRetroPrompt(issueId, inputs);
    writeFileSync(promptFilePath, retroPrompt, 'utf-8');

    // Build launcher scripts
    const innerScript = join(agentDir, 'run-retro.sh');
    const launcherScript = join(agentDir, 'launcher-retro.sh');

    writeFileSync(innerScript, `#!/bin/bash
set -o pipefail
cd "${cwd}"
${PROVIDER_UNSET_LINES}
export CI=1
export PANOPTICON_AGENT_ID="${sessionName}"
export PANOPTICON_ISSUE_ID="${issueId}"
export PANOPTICON_SESSION_TYPE="retro"

prompt=$(cat "${promptFilePath}")
claude --permission-mode acceptEdits --model ${RETRO_MODEL} "$prompt"

echo ""
echo "## Retro-agent completed"
`, { mode: 0o755 });

    writeFileSync(launcherScript, `#!/bin/bash
exec script -qfaec "bash '${innerScript}'" "${logFile}"
`, { mode: 0o755 });

    // Kill any stale retro session for this issue
    await killSessionAsync(sessionName).catch(() => { /* no stale session */ });

    // Spawn tmux session
    await execAsync(
      `${buildTmuxCommandString(['new-session', '-d', '-s', sessionName, '-c', cwd])} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    console.log(`[retro-agent] Spawned session ${sessionName} for ${issueId}`);

    // Snapshot the retros dir before polling so we can detect newly-written files
    const retroOutputDir = join(cwd, 'docs', 'flywheel', 'retros');
    const existingRetroFiles = new Set(await readdir(retroOutputDir).catch(() => [] as string[]));

    // Wait for completion or timeout
    const result = await waitForRetroCompletion(sessionName, issueId, RETRO_TIMEOUT_MS, retroOutputDir, existingRetroFiles);
    return result;

  } catch (err: any) {
    console.error(`[retro-agent] Failed to spawn retro for ${issueId}:`, err);
    return {
      success: false,
      issueId,
      error: err?.message ?? String(err),
    };
  } finally {
    // Always clean up the session — no orphaned retro sessions
    await killSessionAsync(sessionName).catch(() => { /* already gone */ });
    console.log(`[retro-agent] Session ${sessionName} cleaned up`);
  }
}

/**
 * Wait for the retro session to exit, up to the timeout.
 * Polls every 10 seconds to check if the session still exists.
 * Exported for testability.
 */
export async function waitForRetroCompletion(
  sessionName: string,
  issueId: string,
  timeoutMs: number,
  retroOutputDir: string,
  existingFiles: Set<string>,
): Promise<RetroAgentResult> {
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 10_000;

  while (Date.now() < deadline) {
    const exists = await sessionExistsAsync(sessionName).catch(() => false);
    if (!exists) {
      console.log(`[retro-agent] Session ${sessionName} exited`);
      // Verify a retro file was actually written — session can exit without writing (Claude failures, validation errors)
      const afterFiles = await readdir(retroOutputDir).catch(() => [] as string[]);
      const prefix = `${issueId.toLowerCase()}-`;
      const newFile = afterFiles.find(f => f.startsWith(prefix) && !existingFiles.has(f));
      if (!newFile) {
        console.warn(`[retro-agent] Session exited but no retro file found in ${retroOutputDir}`);
        return { success: false, issueId, error: 'No retro file written by agent' };
      }
      const retroFilePath = join(retroOutputDir, newFile);
      console.log(`[retro-agent] Retro file written: ${retroFilePath}`);
      return { success: true, issueId, retroFilePath };
    }
    // Wait before polling again
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Hard cap hit
  console.warn(`[retro-agent] Session ${sessionName} hit 5-minute cap — killing`);
  await killSessionAsync(sessionName).catch(() => { /* ignore */ });
  return {
    success: false,
    issueId,
    error: `Retro-agent exceeded ${timeoutMs / 60000}-minute hard cap`,
    timedOut: true,
  };
}

/**
 * Build the retro prompt string from the skill and bounded inputs.
 */
function buildRetroPrompt(issueId: string, inputs: Awaited<ReturnType<typeof gatherRetroInputs>>): string {
  const sections: string[] = [];

  sections.push(`You are retro-agent for issue ${issueId}.`);
  sections.push(`Your job: read the bounded inputs below and write a surprise-centered retro.`);
  sections.push(`Follow the retro-workflow skill if available.`);
  sections.push(`Output file: docs/flywheel/retros/${issueId.toLowerCase()}-<unix-timestamp>.md`);
  sections.push('');

  if (inputs.stateMd) {
    sections.push('## STATE.md\n');
    sections.push(inputs.stateMd);
    sections.push('');
  }

  if (inputs.vbriefJson) {
    sections.push('## plan.vbrief.json\n');
    sections.push('```json');
    sections.push(inputs.vbriefJson);
    sections.push('```');
    sections.push('');
  }

  const feedbackKeys = Object.keys(inputs.feedbackFiles);
  if (feedbackKeys.length > 0) {
    sections.push('## Feedback files\n');
    for (const name of feedbackKeys) {
      sections.push(`### ${name}\n`);
      sections.push(inputs.feedbackFiles[name]);
      sections.push('');
    }
  }

  const tmuxKeys = Object.keys(inputs.tmuxTails);
  if (tmuxKeys.length > 0) {
    sections.push('## Tmux session tails (last 200 lines)\n');
    for (const [session, tail] of Object.entries(inputs.tmuxTails)) {
      sections.push(`### ${session}\n\`\`\`\n${tail}\n\`\`\``);
      sections.push('');
    }
  }

  if (inputs.flywheelStateRow) {
    sections.push('## FLYWHEEL-STATE row\n');
    sections.push(inputs.flywheelStateRow);
    sections.push('');
  }

  if (inputs.prComments) {
    sections.push('## PR review comments\n');
    sections.push(inputs.prComments);
    sections.push('');
  }

  if (inputs.branchCommits) {
    sections.push('## Branch commits\n');
    sections.push('```');
    sections.push(inputs.branchCommits);
    sections.push('```');
    sections.push('');
  }

  sections.push('---');
  sections.push('Write your retro now. If nothing surprised you, write `no-op` with a one-line reason.');

  return sections.join('\n');
}
