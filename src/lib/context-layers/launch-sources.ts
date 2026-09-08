/** Resolve explicit context inputs without depending on agent lifecycle code. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureSessionContextBriefingFile } from '../briefing-freshness.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { materializeSharedManagedLaunchContext } from './materialize.js';

export async function claudeSystemPromptFiles(workspace: string, harness: RuntimeName | undefined): Promise<string[]> {
  const effectiveHarness = harness ?? 'claude-code';
  const behavior = getHarnessBehavior(effectiveHarness);
  if (behavior.contextLayerKind === 'acp') {
    return [];
  }

  const files: string[] = [];
  if (behavior.contextLayerKind === 'codex') {
    // A private CODEX_HOME moves native ~/.codex/AGENTS.md out of discovery.
    // Preserve that user-authored layer through the explicit developer channel.
    const nativeOverride = join(homedir(), '.codex', 'AGENTS.override.md');
    const nativeGlobal = existsSync(nativeOverride) ? nativeOverride : join(homedir(), '.codex', 'AGENTS.md');
    if (existsSync(nativeGlobal)) files.push(nativeGlobal);
  }

  // Every managed harness receives one current-harness render of Overdeck's
  // global, project, and workspace layers. Native Kimi consumes this file via
  // its once-per-session first-user-message envelope rather than a launch flag.
  files.push(materializeSharedManagedLaunchContext(workspace, effectiveHarness));
  files.push(await ensureSessionContextBriefingFile());

  return files;
}
