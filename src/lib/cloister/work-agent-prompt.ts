import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { renderPrompt } from './prompts.js';
import { extractTeamPrefix, findProjectByTeam } from '../projects.js';
import { readWorkspacePlan } from '../vbrief/io.js';
import { extractACFromDocument } from '../vbrief/acceptance-criteria.js';
import { loadConfig } from '../config.js';
import { createTrackerFromConfig } from '../tracker/factory.js';
import { NotImplementedError } from '../tracker/interface.js';
import type { TrackerType } from '../tracker/interface.js';
import { queryBeadsForIssue } from '../beads-query.js';

export interface WorkAgentPromptContext {
  issueId: string;
  env: 'LOCAL' | 'REMOTE';
  workspacePath: string;
  projectRoot?: string;
  /** Skip dynamic context gathering (filesystem reads). True for REMOTE/dashboard. */
  skipDynamicContext?: boolean;
  /** Pre-fetched tracker context (new comments, status). Injected by callers. */
  trackerContext?: string;
}

export async function buildWorkAgentPrompt(ctx: WorkAgentPromptContext): Promise<string> {
  let beadsTasksStr = '';
  let stitchDesignsStr = '';
  let featureContextStr = '';
  let polyrepoContextStr = '';
  let pendingFeedbackStr = '';

  if (!ctx.skipDynamicContext && ctx.projectRoot) {
    const planningContent = readPlanningContext(ctx.workspacePath);
    const featureContext = readFeatureContext(ctx.workspacePath);

    const beadsTasks = await readBeadsTasks(ctx.workspacePath, ctx.projectRoot, ctx.issueId);
    if (beadsTasks.length > 0) {
      beadsTasksStr = beadsTasks.join('\n');
    }

    const stitchDesigns = extractStitchDesigns(planningContent);
    if (stitchDesigns) {
      stitchDesignsStr = stitchDesigns;
    }

    if (featureContext) {
      featureContextStr = featureContext;
    }

    polyrepoContextStr = buildPolyrepoContext(ctx.issueId, ctx.workspacePath);
    pendingFeedbackStr = readPendingFeedback(ctx.workspacePath);
  }

  return renderPrompt({
    name: 'work',
    vars: {
      ISSUE_ID: ctx.issueId,
      ISSUE_ID_LOWER: ctx.issueId.toLowerCase(),
      WORKSPACE_PATH: ctx.workspacePath,
      LOCAL: ctx.env === 'LOCAL',
      REMOTE: ctx.env === 'REMOTE',
      PROJECT_ROOT: ctx.projectRoot || '',
      BEADS_TASKS: beadsTasksStr,
      STITCH_DESIGNS: stitchDesignsStr,
      FEATURE_CONTEXT: featureContextStr,
      POLYREPO_CONTEXT: polyrepoContextStr,
      PENDING_FEEDBACK: pendingFeedbackStr,
      NEW_TRACKER_CONTEXT: ctx.trackerContext || '',
    },
  });
}

/**
 * Read pending specialist feedback from .planning/feedback/.
 * Returns a summary of the latest feedback file(s) for injection into the prompt.
 */
function readPendingFeedback(workspacePath: string): string {
  const feedbackDir = join(workspacePath, '.planning', 'feedback');
  if (!existsSync(feedbackDir)) return '';

  try {
    const files = readdirSync(feedbackDir)
      .filter(f => f.endsWith('.md'))
      .sort(); // NNN-prefixed, so sort gives chronological order

    if (files.length === 0) return '';

    // Show the latest feedback file path (agent will read it)
    const latest = files[files.length - 1];
    const latestPath = join(feedbackDir, latest);
    const lines: string[] = [
      `**${files.length} feedback file(s):**`,
      '',
    ];

    // List all files (most recent last)
    for (const file of files) {
      const filePath = join(feedbackDir, file);
      const marker = file === latest ? ' ← **latest, read this first**' : '';
      lines.push(`- \`${filePath}\`${marker}`);
    }

    lines.push('');
    lines.push(`Use your Read tool to open \`${latestPath}\`, read every line, then address any issues before continuing other work.`);

    return lines.join('\n');
  } catch {
    return '';
  }
}

const COMMENT_BODY_LIMIT = 500;
const TOTAL_CONTEXT_LIMIT = 2000;

/**
 * Fetch tracker context (new comments + issue status) since STATE.md was last modified.
 * Returns a formatted markdown string for injection into the work agent prompt.
 */
export async function getTrackerContext(
  issueId: string,
  workspacePath: string
): Promise<string> {
  let stateMtime: Date | null = null;
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    try {
      stateMtime = statSync(statePath).mtime;
    } catch {
      // Ignore stat errors
    }
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return '_Tracker unavailable: could not load configuration. Check tracker settings manually._';
  }

  const trackersConfig = config.trackers;
  if (!trackersConfig) {
    return '';
  }

  // Try each configured tracker until one can resolve the issue
  const trackerTypes: TrackerType[] = [trackersConfig.primary];
  if (trackersConfig.secondary) {
    trackerTypes.push(trackersConfig.secondary);
  }

  for (const trackerType of trackerTypes) {
    try {
      const tracker = createTrackerFromConfig(trackersConfig, trackerType);

      // Fetch issue and comments in parallel
      const [issue, allComments] = await Promise.all([
        tracker.getIssue(issueId),
        tracker.getComments(issueId).catch((err: unknown) => {
          // GitLab throws NotImplementedError; treat as no comments
          if (err instanceof NotImplementedError) return [];
          throw err;
        }),
      ]);

      // Filter to comments newer than STATE.md mtime
      const newComments = stateMtime
        ? allComments.filter((c) => new Date(c.createdAt) > stateMtime!)
        : allComments;

      // Detect reopened: STATE.md exists (has completion history) but issue is open
      const isReopened =
        stateMtime !== null &&
        (issue.state === 'open' || issue.state === 'in_progress');

      // Build the section
      const lines: string[] = [];

      lines.push('## Tracker Status (Live)');
      lines.push('');

      const stateLabel = issue.rawState ?? issue.state;
      if (isReopened) {
        lines.push(
          `> **ISSUE REOPENED** — Current state: **${stateLabel}**. This issue was previously worked on. Review the tracker for new instructions before fast-pathing to done.`
        );
      } else {
        lines.push(`**Current state:** ${stateLabel}`);
      }

      if (newComments.length > 0) {
        const sinceLabel = stateMtime
          ? `since STATE.md was last updated (${stateMtime.toISOString().slice(0, 10)})`
          : 'all comments';
        lines.push('');
        lines.push(`**New comments ${sinceLabel}:**`);
        lines.push('');

        let totalChars = lines.join('\n').length;
        let truncatedAny = false;

        for (const comment of newComments) {
          let body = comment.body;
          let commentTruncated = false;
          if (body.length > COMMENT_BODY_LIMIT) {
            body = body.slice(0, COMMENT_BODY_LIMIT) + ' [truncated — read full comment on tracker]';
            commentTruncated = true;
            truncatedAny = true;
          }

          const commentBlock = [
            `**${comment.author}** (${comment.createdAt.slice(0, 10)}):`,
            `> ${body.replace(/\n/g, '\n> ')}`,
            '',
          ].join('\n');

          if (totalChars + commentBlock.length > TOTAL_CONTEXT_LIMIT) {
            lines.push('_[Additional comments truncated — check tracker for full history]_');
            truncatedAny = true;
            break;
          }

          lines.push(commentBlock);
          totalChars += commentBlock.length;
        }

        if (truncatedAny) {
          lines.push('');
          lines.push(`_Check the tracker directly for full comment content: ${issue.url}_`);
        }
      } else if (stateMtime) {
        lines.push('');
        lines.push('_No new comments since last STATE.md update._');
      }

      const result = lines.join('\n').trim();
      // If only "no new comments" and not reopened, return empty to suppress the section
      if (!isReopened && newComments.length === 0) {
        return '';
      }
      return result;
    } catch (err: unknown) {
      // Issue not found in this tracker — try next
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes('not found') ||
        message.toLowerCase().includes('404') ||
        message.toLowerCase().includes('no configuration')
      ) {
        continue;
      }
      // Unexpected error (auth failure, network, etc.) — warn in prompt
      return `_Tracker unavailable: ${message}. Check tracker status and review any new comments manually._`;
    }
  }

  // No tracker resolved the issue
  return '';
}

/**
 * Read planning artifacts for an issue (STATE.md, etc.)
 */
export function readPlanningContext(workspacePath: string): string | null {
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    return readFileSync(statePath, 'utf-8');
  }
  return null;
}

/**
 * Read FEATURE-CONTEXT.md for Rally Features so story agents receive
 * feature-level context (child stories, description, URL).
 */
export function readFeatureContext(workspacePath: string): string | null {
  const featureContextPath = join(workspacePath, '.planning', 'FEATURE-CONTEXT.md');
  if (existsSync(featureContextPath)) {
    return readFileSync(featureContextPath, 'utf-8');
  }
  // Story workspaces may not have their own FEATURE-CONTEXT.md — fall back to
  // any sibling feature workspace that has one (e.g. a Rally Feature's context
  // written during planning).
  const projectRoot = dirname(dirname(workspacePath));
  const workspacesDir = join(projectRoot, 'workspaces');
  if (existsSync(workspacesDir)) {
    for (const entry of readdirSync(workspacesDir)) {
      if (entry.startsWith('feature-')) {
        const siblingPath = join(workspacesDir, entry, '.planning', 'FEATURE-CONTEXT.md');
        if (existsSync(siblingPath)) {
          return readFileSync(siblingPath, 'utf-8');
        }
      }
    }
  }
  return null;
}

/**
 * Check if STATE.md contains Stitch design information.
 * Returns the Stitch section if found, null otherwise.
 */
export function extractStitchDesigns(stateContent: string | null): string | null {
  if (!stateContent) return null;

  // Look for Stitch-related sections in STATE.md
  const stitchPatterns = [
    /## UI Designs[\s\S]*?(?=\n## |$)/i,
    /### Stitch Assets[\s\S]*?(?=\n### |\n## |$)/i,
    /## Stitch[\s\S]*?(?=\n## |$)/i,
  ];

  for (const pattern of stitchPatterns) {
    const match = stateContent.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  // Also check for Stitch project/screen IDs mentioned anywhere
  if (
    stateContent.includes('Stitch') &&
    (stateContent.includes('Project ID') || stateContent.includes('Screen ID'))
  ) {
    const lines = stateContent.split('\n');
    const stitchLines: string[] = [];
    let inStitchSection = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('stitch')) {
        inStitchSection = true;
      }
      if (inStitchSection) {
        stitchLines.push(line);
        if (line.trim() === '' && stitchLines.length > 3) {
          break;
        }
      }
    }

    if (stitchLines.length > 0) {
      return stitchLines.join('\n').trim();
    }
  }

  return null;
}

/**
 * Extract beads IDs from STATE.md content.
 * Looks for patterns like `panopticon-1dg` in backticks or tables.
 */
export function extractBeadsIdsFromState(stateContent: string): string[] {
  const ids: string[] = [];

  const backtickMatches = stateContent.match(/`([a-z]+-[a-z0-9]+)`/g) || [];
  for (const match of backtickMatches) {
    const id = match.replace(/`/g, '');
    if (id.match(/^[a-z]+-[a-z0-9]{2,4}$/)) {
      ids.push(id);
    }
  }

  return [...new Set(ids)];
}

/**
 * Read beads tasks for an issue from the live Dolt database via `bd list`.
 * Falls back to `.beads/issues.jsonl` in workspacePath, then projectRoot.
 */
export async function readBeadsTasks(
  workspacePath: string,
  projectRoot: string,
  issueId: string
): Promise<string[]> {
  const tasks: string[] = [];

  const acByTitle = buildACLookupByTitle(workspacePath);

  let beads = await queryBeadsForIssue(workspacePath, issueId);
  if (beads.length === 0) {
    beads = await queryBeadsForIssue(projectRoot, issueId);
  }

  for (const bead of beads) {
    tasks.push(`- [${bead.status || 'open'}] ${bead.title} (${bead.id})`);

    const beadAC = matchBeadToAC(bead.title, acByTitle);
    for (const ac of beadAC) {
      const check = ac.status === 'completed' ? 'x' : ' ';
      tasks.push(`  - [${check}] AC: ${ac.title}`);
    }
  }

  return tasks;
}

/**
 * Build a lookup map from item title (lowercase) → AC sub-items.
 * Used to match beads to their vBRIEF acceptance criteria.
 */
function buildACLookupByTitle(workspacePath: string): Map<string, Array<{ title: string; status: string }>> {
  const lookup = new Map<string, Array<{ title: string; status: string }>>();
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) return lookup;

  const criteria = extractACFromDocument(doc);
  for (const ac of criteria) {
    const key = ac.itemTitle.toLowerCase();
    let list = lookup.get(key);
    if (!list) {
      list = [];
      lookup.set(key, list);
    }
    list.push({ title: ac.title, status: ac.status });
  }

  return lookup;
}

/**
 * Match a bead title to its AC. Bead titles may have a plan ID prefix
 * (e.g., "PAN-408: Create module") — strip it before matching.
 */
function matchBeadToAC(
  beadTitle: string,
  acByTitle: Map<string, Array<{ title: string; status: string }>>
): Array<{ title: string; status: string }> {
  if (acByTitle.size === 0 || !beadTitle) return [];

  // Strip "PAN-XXX: " prefix if present
  const stripped = beadTitle.replace(/^[A-Z]+-\d+:\s*/, '');
  return acByTitle.get(stripped.toLowerCase()) || [];
}

/**
 * Generate polyrepo context section if applicable.
 */
export function buildPolyrepoContext(issueId: string, workspacePath: string): string {
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

  if (
    !projectConfig?.workspace?.type ||
    projectConfig.workspace.type !== 'polyrepo' ||
    !projectConfig.workspace.repos
  ) {
    return '';
  }

  const wsConfig = projectConfig.workspace;
  // repos is guaranteed non-null by the guard above (!projectConfig.workspace.repos returns early)
  const repos = wsConfig.repos!;

  // In progressive mode, only show repos that exist in the workspace
  const isProgressive = wsConfig.progressive && wsConfig.always_include;
  let visibleRepos: typeof repos = repos;

  if (isProgressive) {
    // Check which repos actually exist in the workspace
    const existingRepos = readdirSync(workspacePath).filter(f => {
      const fullPath = join(workspacePath, f);
      return f !== '.planning' && f !== '.claude' && f !== '.pan' && f !== '.beads' && existsSync(fullPath);
    });
    visibleRepos = repos.filter(r => existingRepos.includes(r.name));
  }

  const lines: string[] = [
    '## Project Structure (Polyrepo)',
    '',
    '**IMPORTANT:** This project uses a **polyrepo** structure. The workspace root is NOT a git repository.',
    'Each subdirectory is a separate git worktree:',
    '',
    '| Directory | Purpose |',
    '|-----------|---------|',
  ];

  for (const repo of visibleRepos) {
    const notes: string[] = [];
    if (repo.readonly) notes.push('readonly');
    if (repo.link_type === 'symlink') notes.push('symlink');
    const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    lines.push(`| \`${repo.name}/\` | ${repo.path}${noteStr} |`);
  }

  lines.push('');
  lines.push('**Git operations:**');
  lines.push(
    '- Run `git status`, `git log`, etc. INSIDE the subdirectories (e.g., `cd fe && git status`)'
  );
  lines.push(
    `- The workspace root (\`${workspacePath}\`) has no \`.git\` directory`
  );
  lines.push(
    `- Each subdirectory has its own branch: \`${repos[0]?.branch_prefix || 'feature/'}${issueId.toLowerCase()}\``
  );

  // Add PR target info if specified
  const prTargets = new Set<string>();
  for (const repo of visibleRepos) {
    const prTarget = repo.pr_target || wsConfig.pr_target;
    if (prTarget) prTargets.add(prTarget);
  }
  if (prTargets.size > 0) {
    lines.push('');
    lines.push(`**PR target branch:** \`${[...prTargets].join('` or `')}\` (NOT main/master)`);
  }

  // Progressive workspace: add instructions for adding repos
  if (isProgressive) {
    lines.push('');
    lines.push('## Adding Repositories');
    lines.push('');
    lines.push('This is a **progressive** workspace. Only essential repos are included.');
    lines.push('Use the `/workspace-add-repo` skill to add more repos when needed:');
    lines.push('');
    lines.push('```bash');
    lines.push(`pan workspace add-repo ${issueId.toLowerCase()} <repo-name> [repo-name...]`);
    lines.push('# Or add all repos in a group:');
    lines.push(`pan workspace add-repo ${issueId.toLowerCase()} --group <group-name>`);
    lines.push('```');
    lines.push('');
    lines.push('Available repos not yet in workspace:');

    const existingRepoNames = visibleRepos.map(r => r.name);
    const missingRepos = repos.filter(r => !existingRepoNames.includes(r.name));

    for (const repo of missingRepos) {
      const notes: string[] = [];
      if (repo.readonly) notes.push('readonly');
      if (repo.link_type === 'symlink') notes.push('symlink');
      const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';
      lines.push(`- \`${repo.name}\`${noteStr} — ${repo.path}`);
    }

    // List readonly/symlink repos
    const readonlyRepos = visibleRepos.filter(r => r.readonly || r.link_type === 'symlink');
    if (readonlyRepos.length > 0) {
      lines.push('');
      lines.push('**Readonly repos** (do NOT commit changes):');
      for (const repo of readonlyRepos) {
        lines.push(`- \`${repo.name}/\` — ${repo.path}`);
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}
