import { jsonResponse } from "../http-helpers.js";
/**
 * Mission Control route module — Effect HttpRouter.Layer (PAN-428 B13)
 *
 * Implements all /api/mission-control/* endpoints from the Express server:
 *   GET  /api/mission-control/activity/:issueId
 *   GET  /api/mission-control/planning/:issueId
 *   POST /api/mission-control/planning/:issueId/status-review
 *   POST /api/mission-control/planning/:issueId/upload
 *   POST /api/mission-control/planning/:issueId/sync-discussions
 *   POST /api/mission-control/planning/:issueId/init
 *   GET  /api/mission-control/projects
 */

import { exec } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getAgentRuntimeState } from '../../../lib/agents.js';
import { syncCache, getCostsForIssue } from '../../../lib/costs/index.js';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_PLANNED_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from '../../../lib/paths.js';
import { resolveProjectFromIssue, listProjects } from '../../../lib/projects.js';
import { loadSettings } from '../../../lib/settings.js';
import { loadSettingsApi } from '../../../lib/settings-api.js';
import { getAgentCommand } from '../../../lib/settings.js';
import { getReviewStatus } from '../review-status.js';
import { getLinearApiKey, getGitHubConfig } from '../services/tracker-config.js';
import { IssueDataService } from '../services/issue-data-service.js';

const execAsync = promisify(exec);

// ─── Shared IssueDataService (via singleton) ────────────────────────────────

function getIssueDataService(): IssueDataService {
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssue(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/mission-control/activity/:issueId ───────────────────────

const getMissionControlActivityRoute = HttpRouter.add(
  'GET',
  '/api/mission-control/activity/:issueId',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        const sections: Array<{
          type: string;
          sessionId: string;
          model: string;
          startedAt: string;
          duration: number | null;
          status: string;
          transcript: string;
        }> = [];

        // 1. Check for planning agent sessions
        const agentId = `agent-${issueLower}`;
        const planningAgentId = `planning-${issueLower}`;
        const agentsDir = join(homedir(), '.panopticon', 'agents');

        let hasPlanningSection = false;

        for (const checkId of [planningAgentId, agentId]) {
          const agentDir = join(agentsDir, checkId);
          if (existsSync(agentDir)) {
            const stateFile = join(agentDir, 'state.json');
            if (existsSync(stateFile)) {
              try {
                const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
                const isPlanning = checkId.startsWith('planning-');
                const sectionType = isPlanning ? 'planning' : 'work';
                if (isPlanning) hasPlanningSection = true;

                let transcript = '';
                try {
                  const { stdout } = await execAsync(
                    `tmux capture-pane -t ${checkId} -p -S -500 2>/dev/null || echo ""`,
                    { encoding: 'utf-8', timeout: 5000 }
                  );
                  transcript = stdout.trim();
                } catch { /* agent may not be running */ }

                if (!isPlanning && !transcript) {
                  try {
                    const outputLog = join(agentDir, 'output.log');
                    if (existsSync(outputLog)) {
                      transcript = readFileSync(outputLog, 'utf-8');
                    }
                  } catch { /* skip */ }
                }

                if (isPlanning && !transcript) {
                  try {
                    const projectPath = getProjectPath(undefined, issuePrefix);
                    const stateMdPath = join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning', 'STATE.md');
                    if (existsSync(stateMdPath)) {
                      transcript = `PLANNING COMPLETE\n\n${readFileSync(stateMdPath, 'utf-8')}`;
                    }
                  } catch { /* skip */ }
                }

                const rtState = getAgentRuntimeState(checkId);

                sections.push({
                  type: sectionType,
                  sessionId: checkId,
                  model: state.model || state.runtime || 'unknown',
                  startedAt: state.startedAt || state.createdAt || new Date().toISOString(),
                  duration: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : null,
                  status: rtState?.state === 'active' ? 'running' : rtState?.state === 'suspended' ? 'completed' : (state.status || 'completed'),
                  transcript,
                });
              } catch { /* skip malformed state */ }
            }
          }
        }

        // If no planning agent but STATE.md exists, create synthetic planning section
        if (!hasPlanningSection) {
          try {
            const projectPath = getProjectPath(undefined, issuePrefix);
            const planningDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning');
            const stateMdPath = join(planningDir, 'STATE.md');
            if (existsSync(stateMdPath)) {
              const stateMd = readFileSync(stateMdPath, 'utf-8');
              const statStat = statSync(stateMdPath);
              sections.push({
                type: 'legacy',
                sessionId: `planning-${issueLower}-state`,
                model: 'unknown',
                startedAt: statStat.birthtime?.toISOString() || statStat.mtime.toISOString(),
                duration: null,
                status: 'completed',
                transcript: `PLANNING COMPLETE\n\n${stateMd}`,
              });
            }
          } catch { /* no workspace or planning dir */ }
        }

        // 2. Build specialist sections from review-status history + task files + tmux output
        const centralStatus = getReviewStatus(issueId.toUpperCase());
        if (centralStatus?.history && centralStatus.history.length > 0) {
          const tasksDir = join(homedir(), '.panopticon', 'specialists', 'tasks');
          const taskFilesByType: Record<string, string[]> = { review: [], test: [], merge: [] };
          try {
            if (existsSync(tasksDir)) {
              const taskFiles = readdirSync(tasksDir).filter(f => f.endsWith('.md'));
              for (const f of taskFiles) {
                const content = readFileSync(join(tasksDir, f), 'utf-8');
                if (content.includes(issueId.toUpperCase()) || content.includes(issueId)) {
                  if (f.startsWith('review-agent')) taskFilesByType.review.push(f);
                  else if (f.startsWith('test-agent')) taskFilesByType.test.push(f);
                  else if (f.startsWith('merge-agent')) taskFilesByType.merge.push(f);
                }
              }
              for (const type of Object.keys(taskFilesByType)) {
                taskFilesByType[type].sort();
              }
            }
          } catch { /* ignore task file errors */ }

          const typeMap: Record<string, string> = { review: 'review', test: 'test', merge: 'merge' };
          let currentSection: { type: string; startedAt: string; endedAt?: string; status: string; notes?: string } | null = null;
          const specialistSections: Array<typeof currentSection & {}> = [];

          for (const entry of centralStatus.history) {
            const sectionType = typeMap[entry.type] || entry.type;
            if (entry.status === 'reviewing' || entry.status === 'testing' || entry.status === 'merging') {
              currentSection = { type: sectionType, startedAt: entry.timestamp, status: 'running' };
            } else if (currentSection && currentSection.type === sectionType) {
              currentSection.endedAt = entry.timestamp;
              currentSection.status = entry.status === 'passed' ? 'completed' : entry.status === 'failed' ? 'failed' : 'completed';
              currentSection.notes = (entry as any).notes;
              specialistSections.push(currentSection);
              currentSection = null;
            } else {
              specialistSections.push({
                type: sectionType,
                startedAt: entry.timestamp,
                status: entry.status === 'passed' ? 'completed' : entry.status === 'failed' ? 'failed' : 'completed',
                notes: (entry as any).notes,
              });
            }
          }
          if (currentSection) specialistSections.push(currentSection);

          const taskFileIndex: Record<string, number> = { review: 0, test: 0, merge: 0 };

          for (const ss of specialistSections) {
            const duration = ss.startedAt && ss.endedAt
              ? Math.floor((new Date(ss.endedAt).getTime() - new Date(ss.startedAt).getTime()) / 1000)
              : null;

            const transcriptParts: string[] = [];
            const statusLabel = ss.status === 'completed' ? 'PASSED' : ss.status === 'running' ? 'IN PROGRESS...' : ss.status.toUpperCase();
            transcriptParts.push(`${ss.type.toUpperCase()} ${statusLabel}`);

            const taskFiles = taskFilesByType[ss.type] || [];
            const taskIdx = taskFileIndex[ss.type] || 0;
            if (taskIdx < taskFiles.length) {
              try {
                const taskContent = readFileSync(join(tasksDir, taskFiles[taskIdx]), 'utf-8');
                const taskLines = taskContent.split('\n');
                const meaningfulLines = taskLines.filter(l =>
                  !l.startsWith('```') && !l.startsWith('# EXECUTE') && !l.startsWith('⚠️')
                );
                transcriptParts.push(`\n--- Task ---\n${meaningfulLines.slice(0, 5).join('\n')}`);
              } catch { /* skip */ }
              taskFileIndex[ss.type] = taskIdx + 1;
            }

            if (ss.status === 'running') {
              const ageMs = Date.now() - new Date(ss.startedAt).getTime();
              const STALE_THRESHOLD_MS = 30 * 60 * 1000;

              if (ageMs > STALE_THRESHOLD_MS) {
                ss.status = 'completed';
                transcriptParts[0] = `${ss.type.toUpperCase()} TIMED OUT (no result recorded)`;
              } else {
                const tmuxName = `specialist-${ss.type === 'review' ? 'review-agent' : ss.type === 'test' ? 'test-agent' : 'merge-agent'}`;
                try {
                  const { stdout } = await execAsync(
                    `tmux capture-pane -t ${tmuxName} -p -S -100 2>/dev/null || echo ""`,
                    { encoding: 'utf-8', timeout: 5000 }
                  );
                  const output = stdout.trim();
                  if (output && (output.includes(issueId.toUpperCase()) || output.includes(issueId) || output.includes(issueLower))) {
                    transcriptParts.push(`\n--- Live Output ---\n${output}`);
                  } else if (output) {
                    transcriptParts.push(`\n--- Waiting ---\nSpecialist is processing another issue. Will update when it reaches ${issueId}.`);
                  }
                } catch { /* specialist may not be running */ }
              }
            }

            if (ss.notes) {
              transcriptParts.push(`\n--- Results ---\n${ss.notes}`);
            }

            sections.push({
              type: ss.type,
              sessionId: `specialist-${ss.type}-${ss.startedAt}`,
              model: 'specialist',
              startedAt: ss.startedAt,
              duration,
              status: ss.status,
              transcript: transcriptParts.join('\n'),
            });
          }
        }

        // Sort sections by startedAt
        sections.sort((a, b) => {
          if (!a.startedAt) return 1;
          if (!b.startedAt) return -1;
          return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        });

        // 3. Include cost breakdown per stage
        let costByStage: Record<string, { cost: number; tokens: number }> = {};
        let totalCost = 0;
        try {
          syncCache();
          const issueData = getCostsForIssue(issueId.toUpperCase());
          if (issueData) {
            totalCost = issueData.totalCost;
            costByStage = Object.fromEntries(
              Object.entries(issueData.stages || {}).map(([stage, stats]) => [
                stage,
                { cost: stats.cost, tokens: stats.tokens }
              ])
            );
          }
        } catch { /* cost data optional */ }

        return jsonResponse({ issueId, sections, costByStage, totalCost });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error fetching mission control activity:', error);
          return jsonResponse({ error: 'Failed to fetch activity: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: GET /api/mission-control/planning/:issueId ───────────────────────

const getMissionControlPlanningRoute = HttpRouter.add(
  'GET',
  '/api/mission-control/planning/:issueId',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        const projectPath = getProjectPath(undefined, issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const planningDir = join(workspacePath, '.planning');

        const result: {
          prd?: string;
          state?: string;
          inference?: string;
          statusReview?: string;
          statusReviewedAt?: string;
          transcripts: Array<{ filename: string; content: string; uploadedAt: string }>;
          discussions: Array<{ filename: string; content: string; syncedAt: string }>;
          notes: Array<{ filename: string; content: string; uploadedAt: string }>;
        } = {
          transcripts: [],
          discussions: [],
          notes: [],
        };

        if (!existsSync(planningDir)) {
          const activePrdPath = join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR, `${issueLower}-plan.md`);
          if (existsSync(activePrdPath)) result.prd = readFileSync(activePrdPath, 'utf-8');
          return jsonResponse(result);
        }

        const statePath = join(planningDir, 'STATE.md');
        const inferencePath = join(planningDir, 'INFERENCE.md');

        if (existsSync(statePath)) result.state = readFileSync(statePath, 'utf-8');
        if (existsSync(inferencePath)) result.inference = readFileSync(inferencePath, 'utf-8');

        const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');
        if (existsSync(statusReviewPath)) {
          result.statusReview = readFileSync(statusReviewPath, 'utf-8');
          try {
            result.statusReviewedAt = statSync(statusReviewPath).mtime.toISOString();
          } catch { /* skip */ }
        }

        if (!result.prd) {
          const prdsDir = join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR);
          if (existsSync(prdsDir)) {
            for (const subdir of [PROJECT_PRDS_ACTIVE_SUBDIR, PROJECT_PRDS_PLANNED_SUBDIR, PROJECT_PRDS_COMPLETED_SUBDIR]) {
              const subdirPath = join(prdsDir, subdir);
              if (!existsSync(subdirPath)) continue;
              const files = readdirSync(subdirPath).filter(f => f.toLowerCase().includes(issueLower) && f.endsWith('.md'));
              if (files.length > 0) {
                result.prd = readFileSync(join(subdirPath, files[0]), 'utf-8');
                break;
              }
            }
          }
        }

        if (!result.prd && result.state) {
          result.prd = result.state;
        }

        const readArtifactDir = (subdir: string, dateField: string) => {
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

        result.transcripts = readArtifactDir('transcripts', 'uploadedAt') as any;
        result.discussions = readArtifactDir('discussions', 'syncedAt') as any;
        result.notes = readArtifactDir('notes', 'uploadedAt') as any;

        return jsonResponse(result);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error fetching planning artifacts:', error);
          return jsonResponse({ error: 'Failed to fetch planning artifacts: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/mission-control/planning/:issueId/status-review ────────

const postMissionControlStatusReviewRoute = HttpRouter.add(
  'POST',
  '/api/mission-control/planning/:issueId/status-review',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const eventStore = yield* EventStoreService;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        const projectPath = getProjectPath(undefined, issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const planningDir = join(workspacePath, '.planning');

        if (!existsSync(planningDir)) {
          return jsonResponse({ error: 'No planning directory found' }, { status: 404 });
        }

        const statePath = join(planningDir, 'STATE.md');
        const state = existsSync(statePath) ? readFileSync(statePath, 'utf-8') : null;

        const readPlanningSubdir = (subdir: string, limit = 5, maxPerFile = 2000): string => {
          const dirPath = join(planningDir, subdir);
          if (!existsSync(dirPath)) return '';
          const files = readdirSync(dirPath).filter((f: string) => f.endsWith('.md') || f.endsWith('.txt'));
          return files.slice(0, limit).map(file => {
            const content = readFileSync(join(dirPath, file), 'utf-8');
            return `\n### ${file}\n${content.slice(0, maxPerFile)}\n`;
          }).join('');
        };

        const discussionsContent = readPlanningSubdir('discussions');
        const transcriptsContent = readPlanningSubdir('transcripts', 5, 3000);
        const notesContent = readPlanningSubdir('notes');

        let issueContext = '';
        try {
          const issueDataService = getIssueDataService();
          const allIssues = issueDataService.getIssues();
          const issue = allIssues.find((i: any) =>
            i.identifier === issueId || i.identifier?.toLowerCase() === issueId.toLowerCase()
          );
          if (issue) {
            issueContext = `- **Title**: ${issue.title}\n- **Status**: ${issue.rawTrackerState || issue.status}\n- **Assignee**: ${issue.assignee?.name || 'Unassigned'}\n- **Source**: ${issue.source}`;
            if (issue.labels?.length) issueContext += `\n- **Labels**: ${issue.labels.join(', ')}`;
            const children = allIssues.filter((i: any) => i.parentRef === issueId);
            if (children.length > 0) {
              const done = children.filter((c: any) => c.status === 'Done').length;
              const inProgress = children.filter((c: any) => c.status === 'In Progress').length;
              issueContext += `\n- **Child Stories**: ${children.length} total, ${done} done, ${inProgress} in progress`;
              issueContext += `\n\n**Story Breakdown:**\n`;
              for (const child of children.slice(0, 20)) {
                issueContext += `  - ${child.identifier}: ${child.title} [${child.rawTrackerState || child.status}]\n`;
              }
            }
          }
        } catch { /* skip if issue data unavailable */ }

        const hasAnyContent = state || discussionsContent || transcriptsContent || notesContent || issueContext;
        if (!hasAnyContent) {
          return jsonResponse({ error: 'No planning artifacts, discussions, transcripts, or issue data to review against' }, { status: 400 });
        }

        let gitDiff = '';
        let gitDiffFull = '';
        let gitLog = '';
        try {
          const { stdout: diff } = await execAsync(
            `cd "${workspacePath}" && git diff --stat main 2>/dev/null || git diff --stat HEAD~5 2>/dev/null || echo "No git diff available"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          gitDiff = diff.slice(0, 3000);
        } catch { /* skip */ }

        try {
          const { stdout: fullDiff } = await execAsync(
            `cd "${workspacePath}" && git diff main 2>/dev/null || git diff HEAD~5 2>/dev/null || echo ""`,
            { encoding: 'utf-8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
          );
          gitDiffFull = fullDiff.slice(0, 15000);
        } catch { /* skip */ }

        try {
          const { stdout: log } = await execAsync(
            `cd "${workspacePath}" && git log --oneline -20 2>/dev/null || echo "No git log available"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          gitLog = log.slice(0, 2000);
        } catch { /* skip */ }

        let filesChanged = '';
        try {
          const { stdout } = await execAsync(
            `cd "${workspacePath}" && git diff --name-only main 2>/dev/null || git diff --name-only HEAD~5 2>/dev/null || echo "No files changed"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          filesChanged = stdout.slice(0, 2000);
        } catch { /* skip */ }

        const centralReviewStatus = getReviewStatus(issueId.toUpperCase());
        const reviewStatus = centralReviewStatus?.reviewStatus || 'unknown';
        const testStatus = centralReviewStatus?.testStatus || 'unknown';

        const { createHash } = await import('crypto');
        const contentForHash = [state, discussionsContent, transcriptsContent, notesContent, issueContext, gitDiff, gitDiffFull, gitLog, filesChanged, reviewStatus, testStatus].filter(Boolean).join('|');
        const contentHash = createHash('md5').update(contentForHash).digest('hex');

        const hashPath = join(planningDir, '.status-review-hash');
        const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');
        if (existsSync(hashPath) && existsSync(statusReviewPath)) {
          const savedHash = readFileSync(hashPath, 'utf-8').trim();
          if (savedHash === contentHash) {
            const cachedReview = readFileSync(statusReviewPath, 'utf-8');
            const reviewedAt = statSync(statusReviewPath).mtime.toISOString();
            console.log(`[status-review] ${issueId}: no changes detected, returning cached review`);
            return jsonResponse({ success: true, statusReview: cachedReview, reviewedAt, cached: true });
          }
        }

        const now = new Date().toISOString();
        let review: string;

        try {
          const analysisPrompt = `You are a senior technical project manager producing an executive-quality status review of a software feature. This review will be read by engineering leadership and executives to understand the current state of this work.

## Issue: ${issueId}
${issueContext ? `\n${issueContext}\n` : ''}

## Pipeline Status
- Review: ${reviewStatus}
- Tests: ${testStatus}

## STATE.md (Planning Context and Progress Notes)
${state ? state.slice(0, 4000) : '(No STATE.md available)'}

## Files Changed
${filesChanged || 'No changes detected'}

## Git Diff Summary (stats)
${gitDiff || 'No diff available'}

## Actual Code Changes
${gitDiffFull || '(No code diff available)'}

## Recent Commits
${gitLog || 'No commits yet'}

## Discussions & Comments
${discussionsContent || '(No discussions synced)'}

## Meeting Transcripts
${transcriptsContent || '(No transcripts uploaded)'}

## Notes
${notesContent || '(No notes uploaded)'}

---

**IMPORTANT**: Perform a THOROUGH analysis. Cross-reference the actual code changes against the PRD requirements, discussions, and transcripts. Don't just summarize — evaluate whether the implementation correctly addresses each requirement.

Produce a comprehensive status review in markdown format with these sections:

1. **Summary** (2-3 sentences: overall progress, percentage complete estimate, what's done, what's remaining)
2. **Requirements Coverage** (cross-reference EACH PRD requirement against the actual code changes — which requirements are fully implemented, partially implemented, or not yet started. Use a table with columns: Requirement | Status | Evidence. If no PRD, infer requirements from discussions/transcripts/issue tracker data)
3. **Code Quality Assessment** (based on actual code changes: are there any concerns about implementation quality, error handling, test coverage, missing edge cases, security issues?)
4. **Risk Assessment** (blockers, missing tests, incomplete features, concerns from discussions, timeline risks)
5. **Key Decisions & Context** (important points from discussions, transcripts, or notes that affect the work — decisions made, open questions, stakeholder feedback)
6. **Recommendation** (specific next steps, whether it's ready for review/merge, or exactly what needs attention before it can progress)

Be specific: reference actual file names, function names, requirement text, discussion quotes, and transcript highlights. This review should give a reader who hasn't seen the code a clear picture of exactly where things stand.`;

          const apiSettings = loadSettingsApi();
          const statusModelId = (apiSettings.models?.overrides as Record<string, string>)?.['status-review']
            || loadSettings().models.status_review
            || 'claude-sonnet-4-6';
          const { command: cliCmd, args: cliArgs } = getAgentCommand(statusModelId);
          const modelFlag = cliArgs.length > 0 ? ` ${cliArgs.join(' ')}` : '';
          const promptFile = join(planningDir, '.status-review-prompt.tmp');
          writeFileSync(promptFile, analysisPrompt, 'utf-8');
          console.log(`[status-review] ${issueId}: generating with ${cliCmd}${modelFlag}`);
          try {
            const { stdout: aiReview } = await execAsync(
              `cat "${promptFile}" | ${cliCmd} -p${modelFlag} --no-session-persistence`,
              { encoding: 'utf-8', timeout: 120000, maxBuffer: 1024 * 1024 }
            );
            review = `# Status Review - ${issueId}\n\n*AI-Generated: ${now}*\n\n${aiReview.trim()}\n\n---\n*Generated by Panopticon Mission Control AI*`;
          } finally {
            try { unlinkSync(promptFile); } catch { /* ignore */ }
          }
        } catch (llmError: any) {
          console.warn(`AI status review failed for ${issueId}, using static template:`, llmError.message);
          // prd is not available in this scope (not fetched); use undefined for ternary fallback
          const prd: string | undefined = undefined;
          review = `# Status Review - ${issueId}

*Generated: ${now}*
*Note: AI analysis unavailable (${llmError.message}). Showing raw data.*

## Pipeline Status

| Stage | Status |
|-------|--------|
| Work | ${reviewStatus === 'unknown' ? 'In Progress' : 'Complete'} |
| Review | ${reviewStatus} |
| Tests | ${testStatus} |

## PRD Requirements

${prd ? prd.split('\n').filter((l: string) => l.match(/^[-*]\s|^#{1,3}\s|acceptance|criteria|requirement/i)).slice(0, 50).join('\n') : '(No PRD available)'}

## Files Changed
\`\`\`
${filesChanged || 'No changes detected'}
\`\`\`

## Recent Commits
\`\`\`
${gitLog || 'No commits yet'}
\`\`\`

## Discussions
${discussionsContent || '(No discussions synced)'}

## Transcripts
${transcriptsContent || '(No transcripts uploaded)'}

## Notes
${notesContent || '(No notes uploaded)'}

${issueContext ? `## Issue Tracker Data\n${issueContext}\n` : ''}---
*Review by Panopticon Mission Control (static fallback)*
`;
        }

        writeFileSync(statusReviewPath, review, 'utf-8');
        writeFileSync(hashPath, contentHash, 'utf-8');

        Effect.runSync(eventStore.append({ type: 'planning.sync', timestamp: new Date().toISOString(), payload: { issueId, status: 'reviewing' } }));
        return jsonResponse({ success: true, statusReview: review, reviewedAt: now });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error generating status review:', error);
          return jsonResponse({ error: 'Failed to generate status review: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/mission-control/planning/:issueId/upload ────────────────

const postMissionControlUploadRoute = HttpRouter.add(
  'POST',
  '/api/mission-control/planning/:issueId/upload',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { type, filename, content } = body;
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        if (!type || !filename || !content) {
          return jsonResponse({ error: 'type, filename, and content are required' }, { status: 400 });
        }

        if (!['transcript', 'note'].includes(type)) {
          return jsonResponse({ error: 'type must be transcript or note' }, { status: 400 });
        }

        let safeName = (filename as string).replace(/[^a-zA-Z0-9._-]/g, '-');
        let processedContent = content;

        if (safeName.endsWith('.vtt')) {
          const { vttToMarkdown } = await import('../utils/vtt-parser.js');
          processedContent = vttToMarkdown(content);
          safeName = safeName.replace(/\.vtt$/, '.md');
        }

        const ext = safeName.endsWith('.md') || safeName.endsWith('.txt') ? '' : '.md';

        const projectPath = getProjectPath(undefined, issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const subdir = type === 'transcript' ? 'transcripts' : 'notes';
        const dirPath = join(workspacePath, '.planning', subdir);

        mkdirSync(dirPath, { recursive: true });
        const filePath = join(dirPath, safeName + ext);
        writeFileSync(filePath, processedContent, 'utf-8');

        return jsonResponse({ success: true, path: filePath });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error uploading artifact:', error);
          return jsonResponse({ error: 'Failed to upload artifact: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/mission-control/planning/:issueId/sync-discussions ─────

const postMissionControlSyncDiscussionsRoute = HttpRouter.add(
  'POST',
  '/api/mission-control/planning/:issueId/sync-discussions',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { tracker } = body;
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        if (!tracker || !['github', 'linear', 'rally'].includes(tracker)) {
          return jsonResponse({ error: 'tracker must be github, linear, or rally' }, { status: 400 });
        }

        const projectPath = getProjectPath(undefined, issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const discussionsDir = join(workspacePath, '.planning', 'discussions');
        mkdirSync(discussionsDir, { recursive: true });

        const syncedFiles: string[] = [];

        if (tracker === 'github') {
          const ghConfig = getGitHubConfig();
          if (!ghConfig) {
            return jsonResponse({ error: 'GitHub not configured' }, { status: 400 });
          }

          try {
            const issueNum = issueId.replace(/^[A-Z]+-/, '');
            const { stdout } = await execAsync(
              `gh issue view ${issueNum} --repo ${ghConfig.owner}/${ghConfig.repos[0]} --json comments --jq '.comments[] | "## " + .author.login + " (" + .createdAt + ")\\n\\n" + .body + "\\n\\n---\\n"'`,
              { encoding: 'utf-8', timeout: 30000 }
            );

            if (stdout.trim()) {
              const filename = `github-${issueId}-comments.md`;
              const header = `# GitHub Comments for ${issueId}\n\nSynced: ${new Date().toISOString()}\n\n---\n\n`;
              writeFileSync(join(discussionsDir, filename), header + stdout, 'utf-8');
              syncedFiles.push(filename);
            }
          } catch (ghErr: any) {
            console.warn(`Failed to sync GitHub comments for ${issueId}:`, ghErr.message);
          }

          try {
            const { stdout: prList } = await execAsync(
              `gh pr list --repo ${ghConfig.owner}/${ghConfig.repos[0]} --head feature/${issueLower} --json number,title --jq '.[].number'`,
              { encoding: 'utf-8', timeout: 15000 }
            );

            for (const prNum of prList.trim().split('\n').filter(Boolean)) {
              const { stdout: prComments } = await execAsync(
                `gh pr view ${prNum} --repo ${ghConfig.owner}/${ghConfig.repos[0]} --json comments --jq '.comments[] | "## " + .author.login + " (" + .createdAt + ")\\n\\n" + .body + "\\n\\n---\\n"'`,
                { encoding: 'utf-8', timeout: 15000 }
              );

              if (prComments.trim()) {
                const filename = `pr-${prNum}-discussion.md`;
                const header = `# PR #${prNum} Discussion\n\nSynced: ${new Date().toISOString()}\n\n---\n\n`;
                writeFileSync(join(discussionsDir, filename), header + prComments, 'utf-8');
                syncedFiles.push(filename);
              }
            }
          } catch { /* no PR found */ }
        } else if (tracker === 'linear') {
          const linearApiKey = getLinearApiKey();
          if (!linearApiKey) {
            return jsonResponse({ error: 'Linear not configured' }, { status: 400 });
          }

          try {
            const response = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': linearApiKey,
              },
              body: JSON.stringify({
                query: `query { issueSearch(filter: { identifier: { eq: "${issueId}" } }) { nodes { comments { nodes { body createdAt user { name } } } } } }`,
              }),
            });

            const data = await response.json() as any;
            const comments = data?.data?.issueSearch?.nodes?.[0]?.comments?.nodes || [];

            if (comments.length > 0) {
              const filename = `linear-${issueId}-comments.md`;
              const header = `# Linear Comments for ${issueId}\n\nSynced: ${new Date().toISOString()}\n\n---\n\n`;
              const commentBody = comments.map((c: any) =>
                `## ${c.user?.name || 'Unknown'} (${c.createdAt})\n\n${c.body}\n\n---\n`
              ).join('\n');
              writeFileSync(join(discussionsDir, filename), header + commentBody, 'utf-8');
              syncedFiles.push(filename);
            }
          } catch (linearErr: any) {
            console.warn(`Failed to sync Linear comments for ${issueId}:`, linearErr.message);
          }
        } else if (tracker === 'rally') {
          try {
            const issueDataService = getIssueDataService();
            const allIssues = issueDataService.getIssues();
            const parentFeature = allIssues.find((i: any) =>
              i.source === 'rally' && i.identifier === issueId
            );
            const childStories = allIssues.filter((i: any) =>
              i.source === 'rally' && i.parentRef === issueId
            );

            if (childStories.length > 0 || parentFeature) {
              const filename = `rally-${issueId}-stories.md`;
              const lines: string[] = [
                `# Rally Stories for ${issueId}`,
                '',
                `Synced: ${new Date().toISOString()}`,
                '',
              ];

              if (parentFeature) {
                lines.push(`**Feature**: ${parentFeature.title}`);
                lines.push(`**Rally State**: ${parentFeature.rawTrackerState || parentFeature.status}`);
                if (parentFeature.derivedStatus) {
                  lines.push(`**Derived Status**: ${parentFeature.derivedStatus}`);
                }
                lines.push(`**Stories**: ${parentFeature.totalChildCount || childStories.length} total, ${parentFeature.completedChildCount || 0} done, ${parentFeature.inProgressChildCount || 0} active`);
                lines.push('');
              }

              lines.push('---', '', '## Child Stories', '');

              for (const story of childStories) {
                const statusEmoji = story.status === 'Done' ? '\u2705'
                  : story.status === 'In Progress' ? '\uD83D\uDD04'
                  : story.status === 'In Review' ? '\uD83D\uDC40'
                  : '\u2B1C';
                lines.push(`- ${statusEmoji} **${story.identifier}**: ${story.title}`);
                lines.push(`  - Status: ${story.rawTrackerState || story.status}`);
                if (story.assignee?.name) lines.push(`  - Assignee: ${story.assignee.name}`);
                lines.push('');
              }

              writeFileSync(join(discussionsDir, filename), lines.join('\n'), 'utf-8');
              syncedFiles.push(filename);
            }
          } catch (rallyErr: any) {
            console.warn(`Failed to sync Rally stories for ${issueId}:`, rallyErr.message);
          }
        }

        return jsonResponse({ synced: syncedFiles.length, files: syncedFiles });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error syncing discussions:', error);
          return jsonResponse({ error: 'Failed to sync discussions: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/mission-control/planning/:issueId/init ─────────────────

const postMissionControlPlanningInitRoute = HttpRouter.add(
  'POST',
  '/api/mission-control/planning/:issueId/init',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { shadow } = body;
        const issueLower = issueId.toLowerCase();
        const issuePrefix = issueId.split('-')[0];

        const projectPath = getProjectPath(undefined, issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const planningDir = join(workspacePath, '.planning');

        for (const subdir of ['transcripts', 'discussions', 'notes']) {
          mkdirSync(join(planningDir, subdir), { recursive: true });
        }

        if (shadow) {
          const inferencePath = join(planningDir, 'INFERENCE.md');
          if (!existsSync(inferencePath)) {
            writeFileSync(inferencePath, `# Inference Document - ${issueId}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n\n## Understanding\n\n(pending)\n\n## Gaps & Risks\n\n(pending)\n`, 'utf-8');
          }
        }

        const sessionName = `planning-${issueLower}`;
        Effect.runSync(eventStore.append({ type: 'planning.started', timestamp: new Date().toISOString(), payload: { issueId, sessionName } }));
        return jsonResponse({ success: true, path: planningDir });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error initializing planning directory:', error);
          return jsonResponse({ error: 'Failed to initialize planning directory: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: GET /api/mission-control/projects ────────────────────────────────

const getMissionControlProjectsRoute = HttpRouter.add(
  'GET',
  '/api/mission-control/projects',
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const projects = listProjects();

        const issueTitleMap = new Map<string, string>();
        try {
          const issueDataService = getIssueDataService();
          const allIssues = issueDataService.getIssues();
          for (const issue of allIssues) {
            if (issue.identifier && issue.title) {
              issueTitleMap.set(issue.identifier.toUpperCase(), issue.title);
            }
          }
        } catch { /* non-fatal */ }

        let tmuxSessions: Set<string> = new Set();
        const [tmuxResult, closedIssuesResult] = await Promise.allSettled([
          execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true'),
          execAsync('gh issue list --repo eltmon/panopticon-cli --state closed --limit 200 --json number,title 2>/dev/null || echo "[]"'),
        ]);
        if (tmuxResult.status === 'fulfilled') {
          for (const line of tmuxResult.value.stdout.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) tmuxSessions.add(trimmed);
          }
        }
        if (closedIssuesResult.status === 'fulfilled') {
          try {
            const closedIssues = JSON.parse(closedIssuesResult.value.stdout.trim());
            for (const ci of closedIssues) {
              const key = `PAN-${ci.number}`;
              if (!issueTitleMap.has(key) && ci.title) {
                issueTitleMap.set(key, ci.title.replace(/^PAN-\d+:\s*/i, ''));
              }
            }
          } catch { /* non-fatal */ }
        }

        const projectTree: Array<{
          name: string;
          path: string;
          features: Array<{
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
            isRally?: boolean;
            childCount?: number;
            completedCount?: number;
            inProgressCount?: number;
            rawTrackerState?: string;
          }>;
        }> = [];

        const now = Date.now();
        const RECENT_DAYS = 7;

        for (const project of projects) {
          const projectPath = project.config.path;
          const workspacesDir = join(projectPath, project.config.workspace?.workspaces_dir || 'workspaces');
          const features: typeof projectTree[0]['features'] = [];

          if (existsSync(workspacesDir)) {
            const entries = readdirSync(workspacesDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory() || !entry.name.startsWith('feature-')) continue;

              const featurePath = join(workspacesDir, entry.name);
              const issueLower = entry.name.replace('feature-', '');
              const issueId = issueLower.toUpperCase();
              const planningDir = join(featurePath, '.planning');

              const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
              let agentStatus: string | null = null;
              let lastActivity: number | null = null;
              if (existsSync(join(agentDir, 'state.json'))) {
                try {
                  const state = JSON.parse(readFileSync(join(agentDir, 'state.json'), 'utf-8'));
                  agentStatus = state.state || null;
                  if (state.lastActivity) {
                    lastActivity = new Date(state.lastActivity).getTime();
                  }
                } catch { /* skip */ }
              }

              const hasTmux = tmuxSessions.has(`agent-${issueLower}`);
              const recentMs = RECENT_DAYS * 24 * 60 * 60 * 1000;
              const hasRecentAgentActivity = lastActivity != null && (now - lastActivity) < recentMs;
              const isAgentLive = (agentStatus === 'active' || agentStatus === 'suspended') && (hasTmux || hasRecentAgentActivity);
              let isRecentWorkspace = false;
              try {
                const mtime = statSync(featurePath).mtimeMs;
                isRecentWorkspace = (now - mtime) < recentMs;
              } catch { /* skip */ }

              if (!hasTmux && !isAgentLive && !isRecentWorkspace) continue;

              const hasPlanning = existsSync(planningDir);
              const hasPrd = hasPlanning && existsSync(join(planningDir, 'PLANNING_PROMPT.md'));
              const hasState = hasPlanning && existsSync(join(planningDir, 'STATE.md'));
              const isShadow = hasPlanning && existsSync(join(planningDir, 'INFERENCE.md'));

              const centralReviewStatus = getReviewStatus(issueId);
              const reviewStatus = centralReviewStatus?.reviewStatus || null;
              const testStatus = centralReviewStatus?.testStatus || null;
              const mergeStatus = centralReviewStatus?.mergeStatus || null;

              const heartbeatFile = join(homedir(), '.panopticon', 'heartbeats', `agent-${issueLower}.json`);
              let isHeartbeatFresh = false;
              if (existsSync(heartbeatFile)) {
                try {
                  const hb = JSON.parse(readFileSync(heartbeatFile, 'utf-8'));
                  const hbTime = new Date(hb.timestamp).getTime();
                  isHeartbeatFresh = (now - hbTime) < 10 * 60 * 1000;
                } catch { /* skip */ }
              }
              const isAgentTrulyActive = hasTmux && (isHeartbeatFresh || agentStatus === 'active');

              let stateLabel = 'Idle';
              if (mergeStatus === 'merged') stateLabel = 'Done';
              else if (reviewStatus === 'passed' && testStatus === 'passed') stateLabel = 'Done';
              else if (reviewStatus === 'reviewing' || testStatus === 'testing') stateLabel = 'In Review';
              else if (reviewStatus === 'passed' && testStatus === 'pending') stateLabel = 'In Review';
              else if (isAgentTrulyActive) stateLabel = 'In Progress';
              else if (hasTmux && !isHeartbeatFresh && agentStatus === 'active') stateLabel = 'Has Context';
              else if (agentStatus === 'suspended') stateLabel = 'Suspended';
              else if (hasRecentAgentActivity && agentStatus === 'active' && isHeartbeatFresh) stateLabel = 'In Progress';
              else if (hasPrd && !hasState) stateLabel = 'Planning';
              else if (hasState) stateLabel = 'Has Context';

              let title = issueTitleMap.get(issueId) || '';
              if (!title && hasPrd) {
                try {
                  const promptPath = join(planningDir, 'PLANNING_PROMPT.md');
                  const prdContent = readFileSync(promptPath, 'utf-8');
                  const firstLine = prdContent.split('\n').find(l => l.trim().length > 0) || '';
                  title = firstLine.replace(/^#+\s*/, '').trim();
                } catch { /* skip */ }
              }
              if (!title) title = issueId;

              features.push({
                issueId,
                title,
                branch: `feature/${issueLower}`,
                status: isAgentTrulyActive ? 'running' : hasState ? 'has_state' : 'idle',
                stateLabel,
                agentStatus,
                hasPlanning,
                hasPrd,
                hasState,
                isShadow,
              });
            }
          }

          // Add Rally Features from cached issues
          const existingIds = new Set(features.map(f => f.issueId));
          const issueDataService = getIssueDataService();
          const allIssues = issueDataService.getIssues();
          const projectName = project.config.name || projectPath.split('/').pop() || 'Unknown';

          for (const issue of allIssues) {
            if (issue.source !== 'rally') continue;
            if (!issue.artifactType?.includes('PortfolioItem')) continue;
            if (issue.project?.name !== projectName) continue;
            if (existingIds.has(issue.identifier)) continue;

            let stateLabel = issue.rawTrackerState || issue.status || 'Unknown';
            if (issue.derivedStatus === 'closed') stateLabel = 'Done';
            else if (issue.derivedStatus === 'in_progress') stateLabel = 'In Progress';

            features.push({
              issueId: issue.identifier,
              title: issue.title,
              branch: '',
              status: 'idle',
              stateLabel,
              agentStatus: null,
              hasPlanning: false,
              hasPrd: false,
              hasState: false,
              isShadow: false,
              isRally: true,
              childCount: issue.totalChildCount,
              completedCount: issue.completedChildCount,
              inProgressCount: issue.inProgressChildCount,
              rawTrackerState: issue.rawTrackerState,
            });
          }

          projectTree.push({
            name: projectName,
            path: projectPath,
            features,
          });
        }

        return jsonResponse(projectTree);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error fetching project tree:', error);
          return jsonResponse({ error: 'Failed to fetch project tree: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const missionControlRouteLayer = Layer.mergeAll(
  getMissionControlActivityRoute,
  getMissionControlPlanningRoute,
  postMissionControlStatusReviewRoute,
  postMissionControlUploadRoute,
  postMissionControlSyncDiscussionsRoute,
  postMissionControlPlanningInitRoute,
  getMissionControlProjectsRoute,
);
