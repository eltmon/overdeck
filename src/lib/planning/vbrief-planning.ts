/**
 * vBRIEF Planning Integration
 *
 * Bridges the planning system with vBRIEF structured plans.
 * Handles both single-issue plans (Linear/GitHub) and feature-level
 * plans with story decomposition (Rally).
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Issue } from '../tracker/interface.js';
import {
  planBuilder,
  writePlan,
  readPlan,
  findPlan,
  getItemsByKind,
  getUnblockedItems,
  topologicalOrder,
  validate,
  VBRIEF_PLAN_PATH,
  type VBriefDocument,
  type PlanItem,
  type PlanStatus,
} from '../vbrief/index.js';
import type { ComplexityLevel } from '../cloister/complexity.js';

const execAsync = promisify(exec);

// ── Types ──

export interface VBriefPlanOptions {
  /** The issue being planned */
  issue: Issue;
  /** Workspace path */
  workspacePath: string;
  /** Path to human-written PRD (optional input) */
  prdPath?: string;
  /** Child issues (stories under a Rally Feature) */
  childIssues?: Issue[];
  /** Whether this is a feature-level plan (has child stories) */
  isFeaturePlan?: boolean;
}

export interface VBriefPlanResult {
  /** Path to the written plan file */
  planPath: string;
  /** The vBRIEF document */
  document: VBriefDocument;
  /** Number of items in the plan */
  itemCount: number;
  /** Number of acceptance criteria */
  acceptanceCriteriaCount: number;
  /** Number of dependency edges */
  edgeCount: number;
  /** IDs of unblocked items ready for execution */
  readyItems: string[];
}

export interface BeadsFromVBriefResult {
  success: boolean;
  created: string[];
  errors: string[];
}

// ── Feature-Level Planning (Rally) ──

/**
 * Create an initial feature-level vBRIEF plan from a Rally Feature and its stories.
 *
 * This produces the structural skeleton that the Opus planning agent fills in
 * with architectural decisions, narratives, and acceptance criteria.
 */
export function createFeaturePlanSkeleton(
  feature: Issue,
  childStories: Issue[],
): VBriefDocument {
  const builder = planBuilder(`${feature.ref}: ${feature.title}`)
    .status('draft')
    .author('Panopticon')
    .agent('opus-planning')
    .uri('tracker', feature.url);

  // Placeholder narratives for Opus to fill in
  builder.narrative('Problem', '_To be filled by planning agent_');
  builder.narrative('Constraint', '_To be filled by planning agent_');

  // Add stories as plan items
  for (const story of childStories) {
    builder.addStory(`story.${story.ref}`, `${story.ref}: ${story.title}`, {
      narrative: story.description || undefined,
      rallyRef: story.ref,
      planRef: `file://workspaces/feature-${story.ref.toLowerCase()}/${VBRIEF_PLAN_PATH}`,
    });
  }

  return builder.build();
}

// ── Single-Issue Planning (Linear/GitHub) ──

/**
 * Create an initial single-issue vBRIEF plan skeleton.
 *
 * This is the starting point for the Opus planning agent on Linear/GitHub issues.
 */
export function createIssuePlanSkeleton(issue: Issue): VBriefDocument {
  const builder = planBuilder(`${issue.ref}: ${issue.title}`)
    .status('draft')
    .author('Panopticon')
    .agent('opus-planning')
    .uri('tracker', issue.url);

  builder.narrative('Problem', '_To be filled by planning agent_');

  return builder.build();
}

// ── Beads Creation from vBRIEF ──

/**
 * Create beads tasks from a vBRIEF plan's items.
 *
 * For feature plans: creates beads only for story-level items (not architectural decisions).
 * For issue plans: creates beads for all actionable items (requirements, tasks).
 */
export async function createBeadsFromVBrief(
  doc: VBriefDocument,
  issueId: string,
  workspacePath: string,
): Promise<BeadsFromVBriefResult> {
  const created: string[] = [];
  const errors: string[] = [];

  // Check if bd is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return { success: false, created: [], errors: ['bd (beads) CLI not found in PATH'] };
  }

  // Get actionable items (skip architectural decisions at feature level, they're context)
  const actionableItems = getActionableItems(doc);

  // Get topological order for proper dependency creation
  const order = topologicalOrder(doc);
  const orderedItems = sortByOrder(actionableItems, order);

  // Track created bead IDs for dependency linking
  const beadIds = new Map<string, string>();

  for (const item of orderedItems) {
    const fullName = `${issueId}: ${item.title}`;
    const difficulty = item.metadata?.difficulty || 'simple';
    const phase = item.metadata?.phase;

    try {
      const escapedName = fullName.replace(/"/g, '\\"');
      const labels = [issueId, `difficulty:${difficulty}`];
      if (phase) labels.push(`phase-${phase}`);
      if (item.metadata?.kind) labels.push(item.metadata.kind);

      let cmd = `bd create "${escapedName}" --type task -l "${labels.join(',')}"`;

      // Add description from narrative
      if (item.narrative) {
        const escapedDesc = item.narrative.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        cmd += ` -d "${escapedDesc}"`;
      }

      const { stdout: result } = await execAsync(cmd, { encoding: 'utf-8', cwd: workspacePath });

      // Extract bead ID
      const idMatch = result.match(/bd-[a-f0-9]+/i) || result.match(/([a-f0-9-]{8,})/i);
      if (idMatch && item.id) {
        beadIds.set(item.id, idMatch[0]);
      }

      created.push(fullName);
    } catch (error: any) {
      const errMsg = error.stderr?.toString() || error.message;
      errors.push(`Failed to create "${item.title}": ${errMsg.split('\n')[0]}`);
    }
  }

  // Set dependencies based on vBRIEF edges
  const blockingEdges = (doc.plan.edges || []).filter(e => e.type === 'blocks');
  for (const edge of blockingEdges) {
    const blockedId = beadIds.get(edge.to);
    const blockerId = beadIds.get(edge.from);
    if (blockedId && blockerId) {
      try {
        await execAsync(`bd dep add ${blockedId} ${blockerId}`, {
          encoding: 'utf-8',
          cwd: workspacePath,
        });
      } catch (error: any) {
        errors.push(`Failed to set dependency ${edge.from} blocks ${edge.to}: ${error.message}`);
      }
    }
  }

  // Sync beads to git
  if (created.length > 0) {
    try {
      await execAsync('bd flush', { encoding: 'utf-8', cwd: workspacePath });
    } catch {
      // Flush might fail if no changes, OK
    }
  }

  return { success: errors.length === 0, created, errors };
}

// ── Plan Queries ──

/**
 * Get story items from a feature plan, in dependency order.
 * Used by Cloister to determine workspace spawning order.
 */
export function getOrderedStories(doc: VBriefDocument): PlanItem[] {
  const stories = getItemsByKind(doc, 'story');
  const order = topologicalOrder(doc);
  return sortByOrder(stories, order);
}

/**
 * Get cross-story blocking dependencies from a feature plan.
 * Returns pairs of [blocker story ref, blocked story ref].
 */
export function getStoryDependencies(doc: VBriefDocument): Array<{ blocker: string; blocked: string }> {
  const storyIds = new Set(
    getItemsByKind(doc, 'story').map(s => s.id).filter(Boolean) as string[]
  );

  return (doc.plan.edges || [])
    .filter(e => e.type === 'blocks' && storyIds.has(e.from) && storyIds.has(e.to))
    .map(e => ({ blocker: e.from, blocked: e.to }));
}

/**
 * Check if an issue is a Rally Feature (for determining planning mode).
 */
export function isRallyFeature(issue: Issue): boolean {
  return issue.tracker === 'rally' &&
    (issue.artifactType || '').toLowerCase().startsWith('portfolioitem');
}

/**
 * Generate the planning agent prompt for vBRIEF output.
 *
 * This prompt instructs Opus to produce a valid vBRIEF JSON plan
 * instead of freeform markdown.
 */
export function generateVBriefPlanningPrompt(options: VBriefPlanOptions): string {
  const { issue, workspacePath, prdPath, childIssues, isFeaturePlan } = options;

  const prdContext = prdPath && existsSync(prdPath)
    ? `\n\nHuman-written PRD (requirements input):\n${readFileSync(prdPath, 'utf-8')}`
    : '';

  const existingPlan = findPlan(workspacePath);
  const skeletonContext = existingPlan
    ? `\n\nExisting plan skeleton (fill in and expand):\n${readFileSync(existingPlan, 'utf-8')}`
    : '';

  const storyContext = isFeaturePlan && childIssues
    ? `\n\nChild stories from Rally:\n${childIssues.map(s => `- ${s.ref}: ${s.title} [${s.rawState || s.state}]\n  ${s.description || '(no description)'}`).join('\n')}`
    : '';

  const planType = isFeaturePlan ? 'feature-level' : 'issue-level';
  const itemGuidance = isFeaturePlan
    ? `This is a FEATURE-LEVEL plan. You must:
- Add architectural_decision items for shared design decisions
- Add story items for each child story with planRef URIs
- Add edges between stories (blocks, informs) for execution ordering
- DO NOT add implementation-level tasks — those go in story-level plans`
    : `This is an ISSUE-LEVEL plan. You must:
- Add requirement items with acceptance_criterion sub-items
- Add task items for implementation work
- Add edges between items for dependency ordering
- Each task should be completable in one focused session`;

  return `You are a planning agent producing a structured vBRIEF plan.

## Issue
- **ID:** ${issue.ref}
- **Title:** ${issue.title}
- **Tracker:** ${issue.tracker}
- **Description:** ${issue.description || '(none)'}
${prdContext}${storyContext}${skeletonContext}

## Your Task

Produce a ${planType} vBRIEF plan as valid JSON. ${itemGuidance}

## vBRIEF Format Requirements

The output must be a valid JSON object with this structure:
\`\`\`json
{
  "vBRIEFInfo": { "version": "0.5" },
  "plan": {
    "title": "${issue.ref}: ${issue.title}",
    "status": "approved",
    "narratives": {
      "Problem": "...",
      "Constraint": "...",
      "Risk": "...",
      "Alternative": "..."
    },
    "items": [
      {
        "id": "dotted.id",
        "title": "Human-readable title",
        "status": "pending",
        "narrative": "Rationale and details",
        "metadata": { "kind": "requirement|acceptance_criterion|architectural_decision|story|task|risk|constraint" },
        "subItems": [],
        "planRef": "file://... (for stories only)"
      }
    ],
    "edges": [
      { "from": "item.id", "to": "other.id", "type": "blocks|informs" }
    ]
  }
}
\`\`\`

## Rules
1. Every requirement MUST have acceptance_criterion sub-items
2. Every item MUST have an id (dot-notation) and narrative
3. Edges must reference valid item IDs
4. No dependency cycles in blocking edges
5. Write the plan to: ${join(workspacePath, VBRIEF_PLAN_PATH)}
6. Also maintain STATE.md for operational state tracking
7. After writing the plan, create beads from the plan items

## Exploration
Before writing the plan, explore the codebase thoroughly:
- Find all related files
- Understand current architecture and patterns
- Read key files completely
- Identify files to create, modify, or delete`.trim();
}

// ── Feature Context Injection ──

/**
 * Inject feature plan context into a story workspace.
 *
 * When a story workspace is created under a Rally Feature, this writes
 * a FEATURE-CONTEXT.md file that the work agent prompt picks up.
 * Contains architectural decisions and cross-story awareness.
 */
export function injectFeatureContext(
  storyWorkspacePath: string,
  featurePlan: VBriefDocument,
  storyRef: string,
): void {
  const decisions = getItemsByKind(featurePlan, 'architectural_decision');
  const stories = getItemsByKind(featurePlan, 'story');
  const deps = getStoryDependencies(featurePlan);

  const storyItemId = stories.find(s => s.metadata?.rally_ref === storyRef)?.id;
  const blockers = storyItemId
    ? deps.filter(d => d.blocked === storyItemId).map(d => {
        const blockerStory = stories.find(s => s.id === d.blocker);
        return blockerStory?.title || d.blocker;
      })
    : [];

  const lines: string[] = [
    `# Feature Context`,
    ``,
    `> Inherited from feature plan: ${featurePlan.plan.title}`,
    ``,
  ];

  // Architectural decisions
  if (decisions.length > 0) {
    lines.push(`## Architectural Decisions (Feature-Level)`);
    lines.push(``);
    for (const decision of decisions) {
      lines.push(`### ${decision.title}`);
      if (decision.narrative) lines.push(decision.narrative);
      lines.push(``);
    }
  }

  // Cross-story awareness
  if (stories.length > 1) {
    lines.push(`## Sibling Stories`);
    lines.push(``);
    for (const story of stories) {
      const marker = story.metadata?.rally_ref === storyRef ? ' **(this story)**' : '';
      lines.push(`- ${story.title}${marker}`);
    }
    lines.push(``);
  }

  // Blockers
  if (blockers.length > 0) {
    lines.push(`## Blockers`);
    lines.push(``);
    lines.push(`This story is blocked by:`);
    for (const blocker of blockers) {
      lines.push(`- ${blocker}`);
    }
    lines.push(``);
  }

  // Shared narratives from feature plan
  if (featurePlan.plan.narratives) {
    lines.push(`## Feature Context (Narratives)`);
    lines.push(``);
    for (const [key, value] of Object.entries(featurePlan.plan.narratives)) {
      if (!value.includes('_To be filled')) {
        lines.push(`**${key}:** ${value}`);
        lines.push(``);
      }
    }
  }

  const contextPath = join(storyWorkspacePath, '.planning', 'FEATURE-CONTEXT.md');
  mkdirSync(join(storyWorkspacePath, '.planning'), { recursive: true });
  writeFileSync(contextPath, lines.join('\n'));
}

// ── Internal Helpers ──

/**
 * Get items that should become beads (skip architectural decisions at feature level).
 */
function getActionableItems(doc: VBriefDocument): PlanItem[] {
  const items: PlanItem[] = [];

  function walk(planItems: PlanItem[]): void {
    for (const item of planItems) {
      const kind = item.metadata?.kind;
      // Skip architectural decisions and stories (stories get their own workspaces)
      if (kind === 'architectural_decision' || kind === 'story') continue;
      // Skip acceptance criteria — they're tracked as sub-items of requirements
      if (kind === 'acceptance_criterion') continue;

      if (kind === 'requirement' || kind === 'task' || !kind) {
        items.push(item);
      }

      // Don't recurse into subItems — they're tracked under their parent
    }
  }

  walk(doc.plan.items);
  return items;
}

/**
 * Sort items by topological order. Items not in the order go last.
 */
function sortByOrder(items: PlanItem[], order: string[]): PlanItem[] {
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const aIdx = a.id ? (orderMap.get(a.id) ?? Infinity) : Infinity;
    const bIdx = b.id ? (orderMap.get(b.id) ?? Infinity) : Infinity;
    return aIdx - bIdx;
  });
}
