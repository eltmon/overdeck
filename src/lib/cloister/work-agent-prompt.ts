import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { ContinueFeedbackEntry } from '../vbrief/continue-state.js';
import { renderPrompt } from './prompts.js';
import { extractTeamPrefix, findProjectByTeam } from '../projects.js';
import { getWorkspacePanPaths, readWorkspaceContext, readFeedback, readWorkspaceContinue, writeWorkspaceContext } from '../pan-dir/index.js';
import { findPlan, readWorkspacePlan, readPlan } from '../vbrief/io.js';
import { createActiveSlice, getDispatchableItems, verifyActiveSlicePromptReduction } from '../vbrief/dag.js';
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
    const featureContext = await readFeatureContext(ctx.workspacePath, ctx.issueId);

    const beadsTasks = await readBeadsTasks(ctx.workspacePath, ctx.projectRoot, ctx.issueId);
    if (beadsTasks.length > 0) {
      beadsTasksStr = beadsTasks.join('\n');
    }

    const stitchDesigns = extractStitchDesigns(planningContent);
    if (stitchDesigns) {
      stitchDesignsStr = stitchDesigns;
    }

    const activeSliceContext = buildActiveSliceContext(ctx.workspacePath, ctx.issueId);
    if (activeSliceContext) {
      featureContextStr = activeSliceContext;
    } else if (featureContext) {
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


function buildActiveSliceContext(workspacePath: string, issueId: string): string {
  try {
    const doc = readWorkspacePlan(workspacePath);
    if (!doc) return '';
    const nextItem = getDispatchableItems(doc, new Set())[0];
    if (!nextItem) return '';
    const slice = createActiveSlice(doc, { issueId: issueId.toUpperCase(), itemId: nextItem.id });
    const measurement = verifyActiveSlicePromptReduction(doc, slice);
    return [
      '## Active vBRIEF Slice (Canonical Task Graph)',
      '',
      slice.prompt,
      '',
      `Prompt-size check: active slice ${measurement.activeSliceBytes} bytes vs full plan ${measurement.fullPlanBytes} bytes (${Math.round(measurement.reductionRatio * 100)}%).`,
      '',
      '_vBRIEF is the canonical task authority during PAN-977 migration; Beads remain a compatibility mirror._',
    ].join('\n');
  } catch {
    return '';
  }
}

/**
 * Read pending specialist feedback.
 * Primary source: workspace `.pan/continue.json` feedback[] plus `.pan/feedback/`.
 */
function readPendingFeedback(workspacePath: string): string {
  const issueId = inferIssueIdFromWorkspace(workspacePath);
  const projectRoot = join(workspacePath, '..', '..');

  const continueEntries: ContinueFeedbackEntry[] = [];
  if (issueId) {
    try {
      const cont = readWorkspaceContinue(workspacePath)
      if (cont?.feedback?.length) {
        continueEntries.push(...cont.feedback)
      }
    } catch { /* ignore */ }
  }

  // --- Backward compat: filesystem files not already in continue file ---
  const seqsInContinue = new Set(continueEntries.map(e => e.seq));
  const legacyFilePaths: string[] = [];
  try {
    for (const file of readFeedback(workspacePath)) {
      const match = file.filename.match(/^(\d{3})-/);
      const seq = match ? parseInt(match[1], 10) : -1;
      if (!seqsInContinue.has(seq)) {
        legacyFilePaths.push(file.path);
      }
    }
  } catch { /* ignore */ }

  if (continueEntries.length === 0 && legacyFilePaths.length === 0) return '';

  const lines: string[] = [];
  const total = continueEntries.length + legacyFilePaths.length;

  // Format continue file entries inline (agent reads them directly from prompt)
  if (continueEntries.length > 0) {
    lines.push(`**${total} feedback item(s) from specialist pipeline:**`);
    lines.push('');
    for (const entry of continueEntries) {
      const seqStr = String(entry.seq).padStart(3, '0');
      lines.push(`### ${seqStr} — ${entry.specialist}: ${entry.outcome.toUpperCase()} (${entry.timestamp})`);
      lines.push('');
      lines.push(entry.markdownBody);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Format legacy filesystem entries as file paths (agent must Read them)
  if (legacyFilePaths.length > 0) {
    if (continueEntries.length === 0) {
      lines.push(`**${total} feedback file(s):**`);
      lines.push('');
    } else {
      lines.push(`**${legacyFilePaths.length} legacy feedback file(s) (pre-migration, read these too):**`);
      lines.push('');
    }
    const latestLegacy = legacyFilePaths[legacyFilePaths.length - 1];
    for (const filePath of legacyFilePaths) {
      const marker = filePath === latestLegacy && continueEntries.length === 0 ? ' ← **latest, read this first**' : '';
      lines.push(`- \`${filePath}\`${marker}`);
    }
    if (continueEntries.length === 0) {
      lines.push('');
      lines.push(`Use your Read tool to open \`${latestLegacy}\`, read every line, then address any issues before continuing other work.`);
    }
  }

  return lines.join('\n');
}

const COMMENT_BODY_LIMIT = 500;
const TOTAL_CONTEXT_LIMIT = 2000;

/**
 * Fetch tracker context (new comments + issue status) since continue file was last modified.
 * Returns a formatted markdown string for injection into the work agent prompt.
 */
export async function getTrackerContext(
  issueId: string,
  workspacePath: string
): Promise<string> {
  let stateMtime: Date | null = null;

  // Find continue file mtime via workspace `.pan/continue.json` first, then migration fallbacks.
  try {
    const workspaceContinuePath = getWorkspacePanPaths(workspacePath).continuePath
    if (existsSync(workspaceContinuePath)) {
      stateMtime = statSync(workspaceContinuePath).mtime
    }
  } catch { /* ignore */ }

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

      // Filter to comments newer than continue file mtime
      const newComments = stateMtime
        ? allComments.filter((c) => new Date(c.createdAt) > stateMtime!)
        : allComments;

      // Detect reopened: continue file exists (has completion history) but issue is open
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
          ? `since continue file was last updated (${stateMtime.toISOString().slice(0, 10)})`
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
        lines.push('_No new comments since last continue file update._');
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
 * Read planning artifacts for an issue from workspace `.pan/continue.json`.
 */
export function readPlanningContext(workspacePath: string): string | null {
  const issueId = inferIssueIdFromWorkspace(workspacePath);
  if (!issueId) return null;

  try {
    const workspaceContinue = readWorkspaceContinue(workspacePath)
    if (workspaceContinue) {
      return JSON.stringify(workspaceContinue, null, 2)
    }
  } catch { /* ignore */ }

  return null;
}

function inferIssueIdFromWorkspace(workspacePath: string): string | null {
  const base = workspacePath.split('/').pop() || '';
  const match = base.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Read workspace `.pan/context.md` for Rally Features so story agents receive
 * feature-level context (child stories, description, URL).
 * Falls back to a deterministic tracker-based parent workspace lookup.
 */
export async function readFeatureContext(workspacePath: string, issueId: string): Promise<string | null> {
  const panContext = readWorkspaceContext(workspacePath)
  if (panContext) {
    return panContext
  }

  // Deterministic O(1) lookup: query tracker for parentRef, then load directly
  try {
    const config = loadConfig();
    const trackersConfig = config.trackers;
    if (!trackersConfig) return null;

    const trackerTypes: TrackerType[] = [trackersConfig.primary];
    if (trackersConfig.secondary) trackerTypes.push(trackersConfig.secondary);

    for (const trackerType of trackerTypes) {
      try {
        const tracker = createTrackerFromConfig(trackersConfig, trackerType);
        const issue = await tracker.getIssue(issueId);
        if (issue.parentRef) {
          const projectRoot = dirname(dirname(workspacePath));
          const parentWorkspace = join(projectRoot, 'workspaces', `feature-${issue.parentRef.toLowerCase()}`);
          const parentPanContext = readWorkspaceContext(parentWorkspace)
          if (parentPanContext) {
            return parentPanContext
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // tracker unavailable
  }

  return null;
}

/**
 * Synthesize and write feature context into a story workspace before
 * work-agent startup. Loads the parent feature workspace spec, extracts
 * narratives and cross-story dependency edges, and writes synthesized
 * context so the story agent has deterministic O(1) access.
 */
export async function writeStoryFeatureContext(workspacePath: string, issueId: string): Promise<void> {
  if (readWorkspaceContext(workspacePath)) return;

  try {
    const config = loadConfig();
    const trackersConfig = config.trackers;
    if (!trackersConfig) return;

    const trackerTypes: TrackerType[] = [trackersConfig.primary];
    if (trackersConfig.secondary) trackerTypes.push(trackersConfig.secondary);

    for (const trackerType of trackerTypes) {
      try {
        const tracker = createTrackerFromConfig(trackersConfig, trackerType);
        const issue = await tracker.getIssue(issueId);
        if (!issue.parentRef) return;

        // Load parent feature title for richer context
        let parentTitle = issue.parentRef;
        try {
          const parentIssue = await tracker.getIssue(issue.parentRef);
          if (parentIssue.title) parentTitle = parentIssue.title;
        } catch {
          // fallback to ref
        }

        const projectRoot = dirname(dirname(workspacePath));
        const parentWorkspace = join(projectRoot, 'workspaces', `feature-${issue.parentRef.toLowerCase()}`);
        const parentPlanPath = findPlan(parentWorkspace);

        let contextContent = '';

        if (parentPlanPath) {
          try {
            const parentDoc = readPlan(parentPlanPath);
            const plan = parentDoc.plan;

            const narratives = plan.narratives;
            const narrativeSection = narratives
              ? Object.entries(narratives)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `### ${k}\n${v}`)
                  .join('\n\n')
              : '';

            const edgesSection = plan.edges?.length > 0
              ? plan.edges.map(e => `- **${e.from}** ${e.type} **${e.to}**`).join('\n')
              : '';

            const storyItems = plan.items.filter(item =>
              item.title.toLowerCase().includes(issueId.toLowerCase()) ||
              item.id.toLowerCase().includes(issueId.toLowerCase()),
            );
            const itemsSection = storyItems.map(item => {
              const subItems = item.subItems?.map(s => `  - ${s.title} (${s.status})`).join('\n') || '';
              return `- **${item.id}**: ${item.title} (${item.status})${item.narrative?.Action ? `\n  - Action: ${item.narrative.Action}` : ''}${subItems ? `\n${subItems}` : ''}`;
            }).join('\n');

            contextContent = `# Feature Context for ${issueId}\n\n` +
              `**Parent Feature:** ${parentTitle} (${issue.parentRef})\n\n` +
              `## Plan Narratives\n${narrativeSection || '_No narratives found._'}\n\n` +
              `## Cross-Story Dependencies\n${edgesSection || '_No dependency edges found._'}\n\n` +
              `## Related Plan Items\n${itemsSection || '_No plan items found for this story._'}\n\n` +
              `---\n*Synthesized from parent feature workspace vBRIEF*\n`;
          } catch (planErr) {
            console.warn(`[writeStoryFeatureContext] Could not read parent workspace vBRIEF: ${planErr instanceof Error ? planErr.message : String(planErr)}`);
          }
        }

        const parentPanContext = readWorkspaceContext(parentWorkspace)
        if (parentPanContext && !contextContent) {
          contextContent = parentPanContext
        }

        if (contextContent) {
          writeWorkspaceContext(workspacePath, contextContent)
        }

        return;
      } catch {
        continue;
      }
    }
  } catch {
    // tracker unavailable
  }
}

/**
 * Check if planning content contains Stitch design information.
 * Returns the Stitch section if found, null otherwise.
 */
export function extractStitchDesigns(stateContent: string | null): string | null {
  if (!stateContent) return null;

  // Look for Stitch-related sections in planning content
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
 * Extract beads IDs from planning content.
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
      return f !== '.claude' && f !== '.pan' && f !== '.beads' && existsSync(fullPath);
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
