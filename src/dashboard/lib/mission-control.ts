/**
 * Mission Control - Activity aggregation and planning artifacts logic.
 *
 * Extracted from server/index.ts for testability (PAN-163).
 * These pure functions operate on file-system paths and return structured data.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript: string;
}

export interface PlanningArtifacts {
  prd?: string;
  state?: string;
  inference?: string;
  transcripts: Array<{ filename: string; content: string; uploadedAt: string }>;
  discussions: Array<{ filename: string; content: string; syncedAt: string }>;
  notes: Array<{ filename: string; content: string; uploadedAt: string }>;
}

export interface FeatureInfo {
  issueId: string;
  title: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
}

// ─── Activity Aggregation ────────────────────────────────────────────────────

/**
 * Build activity sections from agent state files (planning + work agents).
 * Does NOT read tmux (that requires exec); transcripts should be provided externally.
 */
export function buildAgentSections(
  agentsDir: string,
  issueLower: string,
): ActivitySection[] {
  const sections: ActivitySection[] = [];
  const planningAgentId = `planning-${issueLower}`;
  const agentId = `agent-${issueLower}`;

  for (const checkId of [planningAgentId, agentId]) {
    const agentDir = join(agentsDir, checkId);
    if (!existsSync(agentDir)) continue;

    const stateFile = join(agentDir, 'state.json');
    if (!existsSync(stateFile)) continue;

    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const isPlanning = checkId.startsWith('planning-');
      const sectionType = isPlanning ? 'planning' : 'work';

      sections.push({
        type: sectionType,
        sessionId: checkId,
        model: state.model || state.runtime || 'unknown',
        startedAt: state.startedAt || state.createdAt || new Date().toISOString(),
        duration: state.startedAt
          ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
          : null,
        status: state.state === 'active'
          ? 'running'
          : state.state === 'suspended'
            ? 'completed'
            : (state.status || 'completed'),
        transcript: '',  // Transcript from tmux must be injected externally
      });
    } catch {
      // Skip malformed state files
    }
  }

  return sections;
}

/**
 * Build activity sections from specialist run logs (review, test, merge).
 */
export function buildSpecialistSections(
  specialistsDir: string,
  issueLower: string,
  projectKeys: string[],
): ActivitySection[] {
  const sections: ActivitySection[] = [];

  if (!existsSync(specialistsDir)) return sections;

  const typeMap: Record<string, string> = {
    'review-agent': 'review',
    'test-agent': 'test',
    'merge-agent': 'merge',
  };

  for (const projectKey of projectKeys) {
    for (const specialistType of ['review-agent', 'test-agent', 'merge-agent']) {
      const runsDir = join(specialistsDir, projectKey, specialistType, 'runs');
      if (!existsSync(runsDir)) continue;

      try {
        const runFiles = readdirSync(runsDir)
          .filter(f => f.includes(issueLower) && f.endsWith('.log'))
          .sort()
          .reverse()
          .slice(0, 3);

        for (const runFile of runFiles) {
          const content = readFileSync(join(runsDir, runFile), 'utf-8');

          const startedMatch = content.match(/Started: (.+)/);
          const statusMatch = content.match(/Status: (.+)/);
          const finishedMatch = content.match(/Finished: (.+)/);

          const startedAt = startedMatch ? startedMatch[1].trim() : '';
          const finishedAt = finishedMatch ? finishedMatch[1].trim() : '';
          const runStatus = statusMatch ? statusMatch[1].trim() : 'completed';

          sections.push({
            type: typeMap[specialistType] || specialistType,
            sessionId: runFile.replace('.log', ''),
            model: 'specialist',
            startedAt,
            duration: startedAt && finishedAt
              ? Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
              : null,
            status: runStatus === 'passed'
              ? 'completed'
              : runStatus === 'failed'
                ? 'failed'
                : 'completed',
            transcript: content,
          });
        }
      } catch {
        // Skip unreadable runs
      }
    }
  }

  return sections;
}

/**
 * Sort activity sections by startedAt ascending.
 */
export function sortSections(sections: ActivitySection[]): ActivitySection[] {
  return [...sections].sort((a, b) => {
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });
}

// ─── Planning Artifacts ──────────────────────────────────────────────────────

/**
 * Read planning artifacts from a workspace's .planning directory.
 */
export function readPlanningArtifacts(planningDir: string): PlanningArtifacts {
  const result: PlanningArtifacts = {
    transcripts: [],
    discussions: [],
    notes: [],
  };

  if (!existsSync(planningDir)) return result;

  // Read core planning docs
  const prdPath = join(planningDir, 'PRD.md');
  const statePath = join(planningDir, 'STATE.md');
  const inferencePath = join(planningDir, 'INFERENCE.md');

  if (existsSync(prdPath)) result.prd = readFileSync(prdPath, 'utf-8');
  if (existsSync(statePath)) result.state = readFileSync(statePath, 'utf-8');
  if (existsSync(inferencePath)) result.inference = readFileSync(inferencePath, 'utf-8');

  // Fallback for PRD
  if (!result.prd) {
    const promptPath = join(planningDir, 'PLANNING_PROMPT.md');
    if (existsSync(promptPath)) result.prd = readFileSync(promptPath, 'utf-8');
  }

  // Read subdirectory artifacts
  const readSubdir = (subdir: string, dateField: 'uploadedAt' | 'syncedAt') => {
    const dirPath = join(planningDir, subdir);
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath)
      .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
      .map(filename => {
        const filePath = join(dirPath, filename);
        const stat = statSync(filePath);
        return {
          filename,
          content: readFileSync(filePath, 'utf-8'),
          [dateField]: stat.mtime.toISOString(),
        };
      })
      .sort((a: any, b: any) => new Date(b[dateField]).getTime() - new Date(a[dateField]).getTime());
  };

  result.transcripts = readSubdir('transcripts', 'uploadedAt') as any;
  result.discussions = readSubdir('discussions', 'syncedAt') as any;
  result.notes = readSubdir('notes', 'uploadedAt') as any;

  return result;
}

/**
 * Upload a planning artifact (transcript or note) to the workspace.
 */
export function uploadPlanningArtifact(
  planningDir: string,
  type: 'transcript' | 'note',
  filename: string,
  content: string,
): { success: boolean; path: string } {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const ext = safeName.endsWith('.md') || safeName.endsWith('.txt') ? '' : '.md';
  const subdir = type === 'transcript' ? 'transcripts' : 'notes';
  const dirPath = join(planningDir, subdir);

  mkdirSync(dirPath, { recursive: true });
  const filePath = join(dirPath, safeName + ext);
  writeFileSync(filePath, content, 'utf-8');

  return { success: true, path: filePath };
}

/**
 * Initialize the .planning directory structure for a workspace.
 */
export function initPlanningDirectory(
  planningDir: string,
  issueId: string,
  shadow: boolean = false,
): void {
  for (const subdir of ['transcripts', 'discussions', 'notes']) {
    mkdirSync(join(planningDir, subdir), { recursive: true });
  }

  if (shadow) {
    const inferencePath = join(planningDir, 'INFERENCE.md');
    if (!existsSync(inferencePath)) {
      writeFileSync(
        inferencePath,
        `# Inference Document - ${issueId}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n\n## Understanding\n\n(pending)\n\n## Gaps & Risks\n\n(pending)\n`,
        'utf-8',
      );
    }
  }
}

// ─── Feature Discovery ───────────────────────────────────────────────────────

/**
 * Determine lifecycle state label for a feature workspace.
 */
export function determineStateLabel(opts: {
  hasTmux: boolean;
  reviewStatus: string | null;
  testStatus: string | null;
  agentStatus: string | null;
  hasRecentAgentActivity: boolean;
  hasPrd: boolean;
  hasState: boolean;
}): string {
  if (opts.hasTmux) return 'In Progress';
  if (opts.reviewStatus === 'passed' && opts.testStatus === 'passed') return 'Done';
  if (opts.reviewStatus === 'reviewing' || opts.reviewStatus === 'pending') return 'In Review';
  if (opts.agentStatus === 'suspended') return 'Suspended';
  if (opts.hasRecentAgentActivity && opts.agentStatus === 'active') return 'In Progress';
  if (opts.hasPrd && !opts.hasState) return 'Planning';
  if (opts.hasState) return 'Has Context';
  return 'Idle';
}

/**
 * Determine feature status for display.
 */
export function determineFeatureStatus(opts: {
  agentStatus: string | null;
  hasRecentAgentActivity: boolean;
  hasTmux: boolean;
  hasState: boolean;
}): string {
  if (opts.agentStatus === 'active' && opts.hasRecentAgentActivity) return 'running';
  if (opts.hasTmux && opts.agentStatus !== 'idle') return 'running';
  if (opts.hasState) return 'has_state';
  return 'idle';
}
