/**
 * Retro-agent bounded input collector (PAN-709)
 *
 * Gathers the bounded set of workspace artifacts that retro-agent reads:
 *   - STATE.md (narrative)
 *   - plan.vbrief.json (plan vs actual)
 *   - feedback/*.md (all review/test feedback files)
 *   - Last 200 lines of each tmux session history in ~/.panopticon/agents/<id>/
 *   - Issue row in docs/FLYWHEEL-STATE.md (cycle count, history)
 *   - `gh pr view --comments` output
 *   - Merge commit + branch commit list
 *
 * All file I/O uses fs/promises (per CLAUDE.md blocking-call rule).
 */

import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PANOPTICON_HOME } from '../paths.js';
import { resolveProjectFromIssue } from '../projects.js';

const execFileAsync = promisify(execFile);

const TMUX_TAIL_LINES = 200;
const FLYWHEEL_STATE_PATH = join(homedir(), 'docs', 'FLYWHEEL-STATE.md');

// ============================================================================
// Types
// ============================================================================

export interface RetroInputBundle {
  issueId: string;
  /** Contents of .planning/STATE.md, or null if not found */
  stateMd: string | null;
  /** Parsed content of .planning/plan.vbrief.json, or null if not found */
  vbriefJson: string | null;
  /** Map from feedback filename to content */
  feedbackFiles: Record<string, string>;
  /** Map from agent session id to last-200-line tail of tmux history */
  tmuxTails: Record<string, string>;
  /** This issue's row in docs/FLYWHEEL-STATE.md, or null if absent */
  flywheelStateRow: string | null;
  /** Output of `gh pr view --comments`, or null if unavailable */
  prComments: string | null;
  /** Formatted list of commits on this feature branch, or null if unavailable */
  branchCommits: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read the last N lines of a text file efficiently.
 * Reads the entire file (logs are small) and takes the tail.
 */
async function readTailLines(filePath: string, lines: number): Promise<string | null> {
  const content = await readFileSafe(filePath);
  if (!content) return null;
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}

/**
 * Extract this issue's row(s) from FLYWHEEL-STATE.md.
 * Returns the matching table row(s) or null if the file/issue is absent.
 */
async function extractFlywheelStateRow(issueId: string): Promise<string | null> {
  const content = await readFileSafe(FLYWHEEL_STATE_PATH);
  if (!content) return null;

  const upper = issueId.toUpperCase();
  const lines = content.split('\n');
  const matching = lines.filter(l => l.includes(upper));
  if (matching.length === 0) return null;
  return matching.join('\n');
}

/**
 * Read feedback files from <workspace>/.planning/feedback/ or <workspace>/feedback/.
 */
async function readFeedbackFiles(workspacePath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const candidates = [
    join(workspacePath, '.planning', 'feedback'),
    join(workspacePath, 'feedback'),
  ];
  for (const dir of candidates) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const content = await readFileSafe(join(dir, entry.name));
        if (content != null) result[entry.name] = content;
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }
  return result;
}

/**
 * Read last 200 lines of every tmux session history for this issue's agents.
 * History files are written by the heartbeat hook to ~/.panopticon/agents/<id>/tmux-tail.txt
 * or captured via `tmux capture-pane`.
 */
async function readTmuxTails(issueId: string): Promise<Record<string, string>> {
  const tails: Record<string, string> = {};
  const agentsDir = join(PANOPTICON_HOME, 'agents');
  const issueLower = issueId.toLowerCase();

  try {
    const entries = await fsPromises.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.endsWith(`-${issueLower}`) && entry.name !== issueLower) continue;

      // Try reading a persisted tmux tail file first
      const tailFile = join(agentsDir, entry.name, 'tmux-tail.txt');
      const tail = await readTailLines(tailFile, TMUX_TAIL_LINES);
      if (tail) {
        tails[entry.name] = tail;
      }
    }
  } catch {
    // Agents dir not found or unreadable — return empty
  }
  return tails;
}

/**
 * Fetch PR review comments via gh CLI.
 */
async function fetchPrComments(issueId: string, workspacePath: string | null): Promise<string | null> {
  try {
    const branch = `feature/${issueId.toLowerCase()}`;
    const opts = workspacePath ? { timeout: 15_000, cwd: workspacePath } : { timeout: 15_000 };
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', branch,
      '--json', 'number,body,comments,reviews',
      '--jq', '.comments[].body + "\n---\n" + .reviews[].body',
    ], opts);
    return stdout.trim() || null;
  } catch {
    // PR may not exist yet or gh may fail — not fatal
    return null;
  }
}

/**
 * List commits on the feature branch vs. main.
 */
async function fetchBranchCommits(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', workspacePath,
      'log', '--oneline', 'origin/main..HEAD',
    ], { timeout: 15_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Gather all bounded inputs for retro-agent for a given issue.
 *
 * @param issueId - The issue ID (e.g., "PAN-709")
 * @returns A structured RetroInputBundle with all available artifacts
 */
export async function gatherRetroInputs(issueId: string): Promise<RetroInputBundle> {
  const project = resolveProjectFromIssue(issueId);
  const workspacePath = project
    ? join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`)
    : null;

  const [
    stateMd,
    vbriefJson,
    feedbackFiles,
    tmuxTails,
    flywheelStateRow,
    prComments,
    branchCommits,
  ] = await Promise.all([
    workspacePath ? readFileSafe(join(workspacePath, '.planning', 'STATE.md')) : null,
    workspacePath ? readFileSafe(join(workspacePath, '.planning', 'plan.vbrief.json')) : null,
    workspacePath ? readFeedbackFiles(workspacePath) : {},
    readTmuxTails(issueId),
    extractFlywheelStateRow(issueId),
    fetchPrComments(issueId, workspacePath),
    workspacePath ? fetchBranchCommits(workspacePath) : null,
  ]);

  return {
    issueId,
    stateMd,
    vbriefJson,
    feedbackFiles,
    tmuxTails,
    flywheelStateRow,
    prComments,
    branchCommits,
  };
}
