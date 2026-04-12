/**
 * Build a context-rich resume prompt for agents being restarted.
 *
 * Reads STATE.md, beads status, and pending feedback to give the agent
 * immediate context about where it left off — avoiding expensive token
 * burn from re-reading files to rediscover state.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { renderPrompt } from './prompts.js';

interface ResumeContext {
  /** Current status from STATE.md header */
  stateStatus: string | null;
  /** Current Phase section from STATE.md */
  currentPhase: string | null;
  /** Remaining Work section from STATE.md */
  remainingWork: string | null;
  /** Full STATE.md content (truncated if huge) */
  stateContent: string | null;
  /** Open beads summary */
  openBeads: string | null;
  /** Pending feedback files */
  pendingFeedback: string[];
  /** How long the agent was stopped */
  stoppedDuration: string | null;
  /** Optional user-provided message */
  userMessage: string | null;
}

function parseStateSection(content: string, sectionName: string): string | null {
  // Match "## Section Name" and capture until the next "## " or end
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = content.match(regex);
  if (!match) return null;
  return match[1].trim() || null;
}

function parseStateStatus(content: string): string | null {
  const match = content.match(/## Status:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function getOpenBeads(workspacePath: string, issueId: string): string | null {
  try {
    const output = execSync(
      `bd list --json -l ${issueId.toLowerCase()} --limit 20`,
      { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
    );
    const beads = JSON.parse(output.trim() || '[]');
    if (!Array.isArray(beads) || beads.length === 0) return null;

    return beads
      .map((b: any) => `- [ ] ${b.id?.slice(0, 16) || '?'}: ${b.title?.slice(0, 80) || 'untitled'}`)
      .join('\n');
  } catch {
    return null;
  }
}

function getPendingFeedback(workspacePath: string): string[] {
  const feedbackDir = join(workspacePath, '.planning', 'feedback');
  if (!existsSync(feedbackDir)) return [];

  try {
    return readdirSync(feedbackDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-5); // Last 5 feedback files
  } catch {
    return [];
  }
}

function getStoppedDuration(agentDir: string): string | null {
  const stateFile = join(agentDir, 'state.json');
  if (!existsSync(stateFile)) return null;

  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    const lastActivity = state.lastActivity;
    if (!lastActivity) return null;

    const elapsed = Date.now() - new Date(lastActivity).getTime();
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours`;
    return `${Math.floor(hours / 24)} days`;
  } catch {
    return null;
  }
}

function gatherResumeContext(
  workspacePath: string,
  issueId: string,
  agentDir: string,
  userMessage?: string,
): ResumeContext {
  const ctx: ResumeContext = {
    stateStatus: null,
    currentPhase: null,
    remainingWork: null,
    stateContent: null,
    openBeads: null,
    pendingFeedback: [],
    stoppedDuration: null,
    userMessage: userMessage || null,
  };

  // Read STATE.md
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    try {
      const content = readFileSync(statePath, 'utf-8');
      // Truncate to 3000 chars to avoid bloating the prompt
      ctx.stateContent = content.length > 3000 ? content.slice(0, 3000) + '\n...(truncated)' : content;
      ctx.stateStatus = parseStateStatus(content);
      ctx.currentPhase = parseStateSection(content, 'Current Phase');
      ctx.remainingWork = parseStateSection(content, 'Remaining Work');
    } catch { /* non-fatal */ }
  }

  // Get open beads
  ctx.openBeads = getOpenBeads(workspacePath, issueId);

  // Get pending feedback
  ctx.pendingFeedback = getPendingFeedback(workspacePath);

  // Get stopped duration
  ctx.stoppedDuration = getStoppedDuration(agentDir);

  return ctx;
}

/**
 * Build the resume prompt that gets passed via `claude --resume <id> -p "<prompt>"`
 */
export function buildResumePrompt(
  workspacePath: string,
  issueId: string,
  agentDir: string,
  userMessage?: string,
): string {
  const ctx = gatherResumeContext(workspacePath, issueId, agentDir, userMessage);
  const issueLower = issueId.toLowerCase();

  const pendingFeedbackBlock = ctx.pendingFeedback.length > 0
    ? `## Pending Feedback (ACTION REQUIRED)\n\nThese feedback files exist in \`.planning/feedback/\` — read and address them:\n${ctx.pendingFeedback.map(f => `- \`.planning/feedback/${f}\``).join('\n')}`
    : '';

  let remainingWorkBlock = '';
  if (ctx.remainingWork) {
    remainingWorkBlock = `## Remaining Work\n\n${ctx.remainingWork}`;
  } else if (ctx.openBeads) {
    remainingWorkBlock = `## Open Beads\n\n${ctx.openBeads}`;
  }

  const noStateBlock = !ctx.stateContent
    ? `## No STATE.md Found\n\nThere is no \`.planning/STATE.md\` in this workspace. Check your conversation history\nabove and \`bd list\` output to determine where you left off. Then create STATE.md\nwith the required format before continuing work.`
    : '';

  let instructionsBlock: string;
  if (ctx.pendingFeedback.length > 0) {
    instructionsBlock = '1. Read the pending feedback files listed above and address them\n2. Verify STATE.md is accurate, update if needed\n3. Continue with the per-bead workflow';
  } else if (ctx.stateStatus?.toLowerCase().includes('ready for merge') ||
             ctx.stateStatus?.toLowerCase().includes('implementation complete')) {
    instructionsBlock = `1. Re-read \`.planning/STATE.md\` to verify status\n2. Run \`bd list -l ${issueLower}\` to check for unclosed beads\n3. If all work is truly done, run \`pan work done\`\n4. If there is remaining work, update STATE.md and continue`;
  } else {
    instructionsBlock = `1. Re-read \`.planning/STATE.md\` to verify it matches reality\n2. Run \`bd ready -l ${issueLower}\` to find the next unblocked bead\n3. Continue with the per-bead workflow (implement → commit → update STATE.md → bd close → wait for inspection)`;
  }

  return renderPrompt({
    name: 'resume-work',
    vars: {
      ISSUE_ID: issueId,
      INSTRUCTIONS_BLOCK: instructionsBlock,
      STOPPED_DURATION: ctx.stoppedDuration || '',
      USER_MESSAGE: ctx.userMessage || '',
      PENDING_FEEDBACK_BLOCK: pendingFeedbackBlock,
      STATE_STATUS: ctx.stateStatus || '',
      CURRENT_PHASE: ctx.currentPhase || '',
      REMAINING_WORK_BLOCK: remainingWorkBlock,
      NO_STATE_BLOCK: noStateBlock,
    },
  });
}
