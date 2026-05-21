/**
 * Shadow Engineering - Monitoring Agent
 *
 * Analyzes artifacts (issue description, comments, transcripts, PRs, code changes)
 * and produces an INFERENCE.md - a living understanding document.
 *
 * The Monitoring Agent runs when a Shadow workspace is created and updates
 * INFERENCE.md as new artifacts arrive.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';

import { PAN_DIRNAME } from '../pan-dir/index.js';

const execAsync = promisify(exec);

export interface MonitoringAgentConfig {
  issueId: string;
  workspacePath: string;
  projectPath: string;
}

export interface InferenceDocument {
  content: string;
  lastUpdated: string;
  artifactsAnalyzed: string[];
  gaps: string[];
  risks: string[];
}

/**
 * Gather all available artifacts for analysis
 */
export async function gatherArtifacts(config: MonitoringAgentConfig): Promise<{
  issueDescription?: string;
  comments: string[];
  transcripts: string[];
  notes: string[];
  codeChanges?: string;
}> {
  const planningDir = join(config.workspacePath, PAN_DIRNAME);
  const artifacts: {
    issueDescription?: string;
    comments: string[];
    transcripts: string[];
    notes: string[];
    codeChanges?: string;
  } = {
    comments: [],
    transcripts: [],
    notes: [],
  };

  // Read issue description from tracker
  try {
    const { stdout } = await execAsync(
      `gh issue view ${config.issueId.replace(/^[A-Z]+-/, '')} --json body --jq '.body' 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    if (stdout.trim()) {
      artifacts.issueDescription = stdout.trim();
    }
  } catch { /* GitHub may not be configured */ }

  // Read discussions from planning directory
  const discussionsDir = join(planningDir, 'discussions');
  if (existsSync(discussionsDir)) {
    for (const file of readdirSync(discussionsDir).filter(f => f.endsWith('.md'))) {
      artifacts.comments.push(readFileSync(join(discussionsDir, file), 'utf-8'));
    }
  }

  // Read transcripts
  const transcriptsDir = join(planningDir, 'transcripts');
  if (existsSync(transcriptsDir)) {
    for (const file of readdirSync(transcriptsDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'))) {
      artifacts.transcripts.push(readFileSync(join(transcriptsDir, file), 'utf-8'));
    }
  }

  // Read notes
  const notesDir = join(planningDir, 'notes');
  if (existsSync(notesDir)) {
    for (const file of readdirSync(notesDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'))) {
      artifacts.notes.push(readFileSync(join(notesDir, file), 'utf-8'));
    }
  }

  // Read recent code changes
  try {
    const { stdout } = await execAsync(
      `cd "${config.workspacePath}" && git log --oneline -20 --format="%h %s" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    if (stdout.trim()) {
      artifacts.codeChanges = stdout.trim();
    }
  } catch { /* git may not be available */ }

  return artifacts;
}

/**
 * Generate the monitoring prompt for the Monitoring Agent
 */
export function generateMonitoringPrompt(
  config: MonitoringAgentConfig,
  artifacts: Awaited<ReturnType<typeof gatherArtifacts>>,
  existingInference?: string
): string {
  const sections: string[] = [];

  sections.push(`# Shadow Engineering - Monitoring Task`);
  sections.push(`\nYou are the Shadow Engineering Monitoring Agent for ${config.issueId}.`);
  sections.push(`Your job is to analyze all available artifacts and produce/update an INFERENCE.md document.`);
  sections.push(`\nThis document should capture your understanding of what the team is building,`);
  sections.push(`identify gaps and ambiguities, surface risks, and track key decisions.`);

  if (existingInference) {
    sections.push(`\n## Current INFERENCE.md\n\n${existingInference}`);
  }

  if (artifacts.issueDescription) {
    sections.push(`\n## Issue Description\n\n${artifacts.issueDescription}`);
  }

  if (artifacts.comments.length > 0) {
    sections.push(`\n## Discussion Comments\n\n${artifacts.comments.join('\n\n---\n\n')}`);
  }

  if (artifacts.transcripts.length > 0) {
    sections.push(`\n## Meeting Transcripts\n\n${artifacts.transcripts.join('\n\n---\n\n')}`);
  }

  if (artifacts.notes.length > 0) {
    sections.push(`\n## Notes\n\n${artifacts.notes.join('\n\n---\n\n')}`);
  }

  if (artifacts.codeChanges) {
    sections.push(`\n## Recent Code Changes\n\n\`\`\`\n${artifacts.codeChanges}\n\`\`\``);
  }

  sections.push(`\n## Your Task`);
  sections.push(`\nAnalyze all the above artifacts and ${existingInference ? 'UPDATE' : 'CREATE'} the INFERENCE.md document.`);
  sections.push(`The document should include:`);
  sections.push(`1. **Summary**: What is the team building? (2-3 sentences)`);
  sections.push(`2. **Architecture**: Key technical decisions and patterns identified`);
  sections.push(`3. **Progress**: What has been done vs what remains`);
  sections.push(`4. **Gaps & Ambiguities**: Questions that need answers`);
  sections.push(`5. **Risks**: Potential issues or concerns`);
  sections.push(`6. **Team Patterns**: How the team works, conventions observed`);
  sections.push(`7. **Recommendations**: Suggestions for the team`);
  sections.push(`\nWrite the INFERENCE.md content to: ${join(config.workspacePath, PAN_DIRNAME, 'INFERENCE.md')}`);

  return sections.join('\n');
}

/**
 * Create a simple inference document from artifacts without using an LLM
 * (for cases where we want to generate it locally without spawning an agent)
 */
export function generateBasicInference(
  config: MonitoringAgentConfig,
  artifacts: Awaited<ReturnType<typeof gatherArtifacts>>
): string {
  const now = new Date().toISOString();
  const sections: string[] = [];

  sections.push(`# Inference Document - ${config.issueId}`);
  sections.push(`\n*Last updated: ${now}*`);
  sections.push(`\n*Generated by Shadow Engineering Monitoring Agent*`);

  sections.push(`\n## Status\n`);
  const artifactCount = artifacts.comments.length + artifacts.transcripts.length + artifacts.notes.length;
  sections.push(`Analyzed ${artifactCount} artifact(s).`);

  if (artifacts.issueDescription) {
    sections.push(`\n## Issue Summary\n`);
    // Take first 500 chars as summary
    const summary = artifacts.issueDescription.slice(0, 500);
    sections.push(summary + (artifacts.issueDescription.length > 500 ? '...' : ''));
  }

  if (artifacts.codeChanges) {
    sections.push(`\n## Recent Activity\n`);
    sections.push('```');
    sections.push(artifacts.codeChanges);
    sections.push('```');
  }

  sections.push(`\n## Artifacts Analyzed\n`);
  if (artifacts.issueDescription) sections.push(`- Issue description`);
  sections.push(`- ${artifacts.comments.length} discussion comment(s)`);
  sections.push(`- ${artifacts.transcripts.length} transcript(s)`);
  sections.push(`- ${artifacts.notes.length} note(s)`);
  if (artifacts.codeChanges) sections.push(`- Code change history`);

  sections.push(`\n## Gaps & Risks\n`);
  sections.push(`(Requires deeper analysis - run full monitoring agent for detailed inference)`);

  return sections.join('\n');
}

/**
 * Update the INFERENCE.md file
 */
export function updateInferenceDocument(workspacePath: string, content: string): void {
  const panDir = join(workspacePath, PAN_DIRNAME);
  mkdirSync(panDir, { recursive: true });
  writeFileSync(join(panDir, 'INFERENCE.md'), content, 'utf-8');
}

/**
 * Read existing INFERENCE.md if it exists
 */
export function readInferenceDocument(workspacePath: string): string | null {
  const filePath = join(workspacePath, PAN_DIRNAME, 'INFERENCE.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Lifts the monitoring-agent I/O surface (gh issue view, git log, fs reads,
// fs writes) into typed Effect channels so callers can compose Shadow
// Engineering monitoring with other Effect-native pipelines without raw
// try/catch.

/** Tagged error for monitoring-agent Effect variants. */
export class MonitoringAgentError extends Data.TaggedError('MonitoringAgentError')<{
  readonly issueId: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const liftMonitoringError = (
  issueId: string,
  operation: string,
  cause: unknown,
): MonitoringAgentError =>
  new MonitoringAgentError({
    issueId,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect variant of `gatherArtifacts`. */
export const gatherArtifactsEffect = (
  config: MonitoringAgentConfig,
): Effect.Effect<Awaited<ReturnType<typeof gatherArtifacts>>, MonitoringAgentError> =>
  Effect.tryPromise({
    try: () => gatherArtifacts(config),
    catch: (cause) => liftMonitoringError(config.issueId, 'gatherArtifacts', cause),
  });

/** Effect variant of `updateInferenceDocument`. */
export const updateInferenceDocumentEffect = (
  workspacePath: string,
  content: string,
): Effect.Effect<void, MonitoringAgentError> =>
  Effect.try({
    try: () => updateInferenceDocument(workspacePath, content),
    catch: (cause) => liftMonitoringError(workspacePath, 'updateInferenceDocument', cause),
  });

/** Effect variant of `readInferenceDocument`. */
export const readInferenceDocumentEffect = (
  workspacePath: string,
): Effect.Effect<string | null, MonitoringAgentError> =>
  Effect.try({
    try: () => readInferenceDocument(workspacePath),
    catch: (cause) => liftMonitoringError(workspacePath, 'readInferenceDocument', cause),
  });
