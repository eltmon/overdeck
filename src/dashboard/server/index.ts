import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
// ssh2 is loaded dynamically only when remote sessions are used
let SSHClient: any = null;
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync, readdirSync, appendFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync, rmSync, symlinkSync, chmodSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { Server as SocketIOServer } from 'socket.io';
import { CacheService } from './services/cache-service.js';
import { IssueDataService } from './services/issue-data-service.js';
import { getLinearApiKey as getLinearApiKeyShared, getGitHubConfig as getGitHubConfigShared, getRallyConfig as getRallyConfigShared } from './services/tracker-config.js';
import { getCloisterService } from '../../lib/cloister/service.js';

const execAsync = promisify(exec);
import { loadCloisterConfig, saveCloisterConfig, shouldAutoStart } from '../../lib/cloister/config.js';
import { loadSettings, saveSettings, validateSettings, getAvailableModels, isAnthropicModel, getClaudeModelFlag, getAgentCommand } from '../../lib/settings.js';
import { loadSettingsApi, saveSettingsApi, validateSettingsApi, getAvailableModelsApi, getOptimalDefaultsApi } from '../../lib/settings-api.js';
import { generateRouterConfig, writeRouterConfig } from '../../lib/router-config.js';
import { spawnMergeAgentForBranches } from '../../lib/cloister/merge-agent.js';
import { checkAgentHealthAsync, determineHealthStatusAsync } from '../lib/health-filtering.js';
import { performHandoff } from '../../lib/cloister/handoff.js';
import { readHandoffEvents, readIssueHandoffEvents, readAgentHandoffEvents, getHandoffStats } from '../../lib/cloister/handoff-logger.js';
import { readSpecialistHandoffs, getSpecialistHandoffStats } from '../../lib/cloister/specialist-handoff-logger.js';
import { checkAllTriggers } from '../../lib/cloister/triggers.js';
import { getAgentState, getAgentRuntimeState, saveAgentRuntimeState, getActivity, appendActivity, saveSessionId, getSessionId, resumeAgent } from '../../lib/agents.js';
import { sendKeys } from '../../lib/tmux.js';
import { getAgentHealth } from '../../lib/cloister/health.js';
import { getRuntimeForAgent } from '../../lib/runtimes/index.js';
import { resolveProjectFromIssue, listProjects, hasProjects, ProjectConfig, findProjectByTeam, extractTeamPrefix } from '../../lib/projects.js';
import { calculateCost, getPricing, TokenUsage } from '../../lib/cost.js';
import { normalizeModelName, getActiveSessionModel } from '../../lib/cost-parsers/jsonl-parser.js';
import { startConvoy, stopConvoy, getConvoyStatus, listConvoys, type ConvoyContext } from '../../lib/convoy.js';
import { loadPanopticonEnv, getApiKeysFromEnv } from '../../lib/env-loader.js';
import { getCostsByIssue, getCacheStatus, syncCache, migrateIfNeeded, needsMigration, rebuildCache, migrateAllSessions, getCostsForIssue, tailEvents, readEvents } from '../../lib/costs/index.js';
import type { Issue } from '../frontend/src/types.js';

// Load environment variables from ~/.panopticon.env at startup
// This makes API keys available to the settings system
const envLoadResult = loadPanopticonEnv();
if (envLoadResult.loaded.length > 0) {
  console.log(`Loaded env vars from ~/.panopticon.env: ${envLoadResult.loaded.join(', ')}`);
}
if (envLoadResult.error) {
  console.warn(`Note: ${envLoadResult.error}`);
}

/**
 * Get a Date object representing 24 hours ago from now.
 * Used for filtering recently completed issues.
 */
function getOneDayAgo(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

// Ensure tmux server is running (starts one if not)
async function ensureTmuxRunning(): Promise<void> {
  try {
    await execAsync('tmux list-sessions 2>/dev/null', { encoding: 'utf-8' });
  } catch (e) {
    // Tmux server not running, start it with a dummy session
    try {
      await execAsync('tmux new-session -d -s panopticon-init', { encoding: 'utf-8' });
      console.log('Started tmux server');
    } catch (startErr) {
      console.error('Failed to start tmux server:', startErr);
    }
  }
}

// Activity log for tracking pan command output
const ACTIVITY_LOG = '/tmp/panopticon-activity.log';

interface ActivityEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
}

// In-memory activity store (last 50 entries)
const activities: ActivityEntry[] = [];
const MAX_ACTIVITIES = 50;

// Cache for agents list to avoid repeated subprocess calls
let agentsCache: { data: any[] | null; timestamp: number } = {
  data: null,
  timestamp: 0,
};
const AGENTS_CACHE_TTL_MS = 2000; // 2 seconds

function logActivity(entry: ActivityEntry) {
  activities.unshift(entry);
  if (activities.length > MAX_ACTIVITIES) {
    activities.pop();
  }
}

function updateActivity(id: string, updates: Partial<ActivityEntry>) {
  const activity = activities.find(a => a.id === id);
  if (activity) {
    Object.assign(activity, updates);
  }
}

function appendActivityOutput(id: string, line: string) {
  const activity = activities.find(a => a.id === id);
  if (activity) {
    activity.output.push(line);
    // Keep only last 100 lines per activity
    if (activity.output.length > 100) {
      activity.output.shift();
    }
  }
}

// ============================================================================
// Pending Operations State - Persists across refreshes and server restarts
// ============================================================================

interface PendingOperation {
  type: 'approve' | 'close' | 'containerize' | 'start' | 'review' | 'merge';
  issueId: string;
  startedAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

// ============================================================================
// Review Status Tracking - Tracks review/test pipeline progress
// ============================================================================

import {
  type ReviewStatus,
  type StatusHistoryEntry,
  loadReviewStatuses,
  saveReviewStatuses,
  setReviewStatus as setReviewStatusBase,
  getReviewStatus,
  clearReviewStatus,
} from './review-status.js';

// Wrapper that adds auto-PR creation logic on top of the base setReviewStatus
function setReviewStatus(issueId: string, update: Partial<ReviewStatus>): ReviewStatus {
  const existing = getReviewStatus(issueId);
  const wasReadyForMerge = existing?.readyForMerge ?? false;

  const updated = setReviewStatusBase(issueId, update);

  // Auto-create PR when ready for merge transitions from false to true
  const becameReadyForMerge = updated.readyForMerge && !wasReadyForMerge;
  if (becameReadyForMerge && !updated.prUrl) {
    console.log(`[pr] Issue ${issueId} is ready for merge, auto-creating PR...`);
    ensurePRExists(issueId).then(result => {
      if (result.prUrl) {
        const freshStatuses = loadReviewStatuses();
        if (freshStatuses[issueId]) {
          freshStatuses[issueId].prUrl = result.prUrl;
          saveReviewStatuses(freshStatuses);
          console.log(`[pr] Updated ${issueId} with PR URL: ${result.prUrl}`);
        }
      } else if (result.error) {
        console.error(`[pr] Failed to create PR for ${issueId}: ${result.error}`);
      }
    }).catch(err => {
      console.error(`[pr] Error creating PR for ${issueId}:`, err);
    });
  }

  return updated;
}

/**
 * Create a PR for an issue if one doesn't already exist
 * Handles both local and remote workspaces
 */
async function ensurePRExists(issueId: string): Promise<{ created: boolean; prUrl?: string; error?: string }> {
  const issueLower = issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  try {
    // Check if PR already exists
    const { stdout: existingPR } = await execAsync(
      `gh pr list --repo eltmon/panopticon-cli --head "${branchName}" --json number,url --jq '.[0].url // empty'`,
      { encoding: 'utf-8' }
    );

    if (existingPR.trim()) {
      console.log(`[pr] PR already exists for ${issueId}: ${existingPR.trim()}`);
      return { created: false, prUrl: existingPR.trim() };
    }

    // Get workspace info to determine if remote or local
    const workspaceInfo = getWorkspaceInfoForIssue(issueId);

    if (!workspaceInfo.exists) {
      return { created: false, error: 'Workspace does not exist' };
    }

    // Get issue title for PR title
    let issueTitle = issueId;
    if (issueId.toUpperCase().startsWith('PAN-')) {
      const issueNumber = issueId.replace(/^PAN-/i, '');
      try {
        const { stdout } = await execAsync(
          `gh issue view ${issueNumber} --repo eltmon/panopticon-cli --json title --jq '.title'`,
          { encoding: 'utf-8' }
        );
        issueTitle = stdout.trim() || issueId;
      } catch {
        // Use issueId as fallback
      }
    }

    // Create PR - different command for remote vs local
    let prUrl: string;

    if (workspaceInfo.isRemote && workspaceInfo.vmName) {
      // Remote workspace: SSH to VM and create PR
      console.log(`[pr] Creating PR for ${issueId} from remote workspace ${workspaceInfo.vmName}...`);

      // First ensure branch is pushed
      await execAsync(
        `ssh -A ${workspaceInfo.vmName}.exe.xyz "cd /workspace && git push -u origin ${branchName} 2>&1 || true"`,
        { encoding: 'utf-8' }
      );

      // Create PR from remote
      const { stdout } = await execAsync(
        `ssh -A ${workspaceInfo.vmName}.exe.xyz "cd /workspace && gh pr create --title '${issueTitle} (${issueId})' --body 'Closes #${issueId.replace(/^PAN-/i, '')}

## Summary
Auto-created PR for ${issueId}

## Test plan
- [x] Review passed
- [x] Tests passed

🤖 Generated with Panopticon' --base main --head ${branchName} 2>&1"`,
        { encoding: 'utf-8' }
      );
      prUrl = stdout.trim();
    } else {
      // Local workspace: create PR directly
      const workspacePath = workspaceInfo.path!;
      console.log(`[pr] Creating PR for ${issueId} from local workspace...`);

      // Ensure branch is pushed
      await execAsync(`git push -u origin ${branchName} 2>&1 || true`, { cwd: workspacePath, encoding: 'utf-8' });

      // Create PR
      const { stdout } = await execAsync(
        `gh pr create --title "${issueTitle} (${issueId})" --body "Closes #${issueId.replace(/^PAN-/i, '')}

## Summary
Auto-created PR for ${issueId}

## Test plan
- [x] Review passed
- [x] Tests passed

🤖 Generated with Panopticon" --base main --head ${branchName}`,
        { cwd: workspacePath, encoding: 'utf-8' }
      );
      prUrl = stdout.trim();
    }

    console.log(`[pr] Created PR for ${issueId}: ${prUrl}`);
    return { created: true, prUrl };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pr] Failed to create PR for ${issueId}:`, message);
    return { created: false, error: message };
  }
}

/**
 * Close an issue after successful merge
 * Handles both GitHub issues (PAN-*) and Linear issues
 */
async function closeIssueAfterMerge(issueId: string): Promise<void> {
  try {
    // Check if it's a GitHub issue (PAN-* prefix)
    if (issueId.toUpperCase().startsWith('PAN-')) {
      const issueNumber = issueId.replace(/^PAN-/i, '');
      console.log(`[merge] Closing GitHub issue #${issueNumber}...`);

      // Use gh CLI to close the issue
      await execAsync(`gh issue close ${issueNumber} --repo eltmon/panopticon-cli --comment "Merged to main"`, {
        encoding: 'utf-8',
      });
      console.log(`[merge] GitHub issue #${issueNumber} closed`);
    } else {
      // Linear issue - update to Done state via GraphQL API
      console.log(`[merge] Moving Linear issue ${issueId} to Done...`);

      const linearApiKey = process.env.LINEAR_API_KEY;
      if (!linearApiKey) {
        console.warn(`[merge] LINEAR_API_KEY not set, cannot auto-close Linear issue ${issueId}`);
        return;
      }

      // First, get the issue to find its team and the Done state
      const issueQuery = `query { issue(id: "${issueId}") { id team { id states { nodes { id name type } } } } }`;
      const issueRes = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': linearApiKey,
        },
        body: JSON.stringify({ query: issueQuery }),
      });

      if (!issueRes.ok) {
        throw new Error(`Linear API error: ${issueRes.status}`);
      }

      const issueData = await issueRes.json() as any;
      const states = issueData.data?.issue?.team?.states?.nodes || [];
      const doneState = states.find((s: any) => s.type === 'completed' || s.name === 'Done');

      if (!doneState) {
        console.warn(`[merge] Could not find Done state for Linear issue ${issueId}`);
        return;
      }

      // Update the issue to Done state
      const updateMutation = `mutation { issueUpdate(id: "${issueId}", input: { stateId: "${doneState.id}" }) { success } }`;
      const updateRes = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': linearApiKey,
        },
        body: JSON.stringify({ query: updateMutation }),
      });

      if (!updateRes.ok) {
        throw new Error(`Linear API update error: ${updateRes.status}`);
      }

      const updateData = await updateRes.json() as any;
      if (updateData.data?.issueUpdate?.success) {
        console.log(`[merge] Linear issue ${issueId} moved to Done`);
      } else {
        console.warn(`[merge] Linear update returned success=false for ${issueId}`);
      }
    }
  } catch (error: unknown) {
    // Log but don't fail the merge - closing is a nice-to-have
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[merge] Failed to close issue ${issueId}:`, message);
  }
}

// ============================================================================
// AUTOMATIC COMPLETION DETECTION
// ============================================================================
// Monitors specialist output and automatically updates review status
// instead of relying on agents to call curl commands manually.

interface ActiveReview {
  issueId: string;
  startedAt: string;
  lastChecked: string;
  phase: 'review' | 'test' | 'merge';
}

const activeReviews: Map<string, ActiveReview> = new Map();

// ============================================================================
// PAN-80: Terminal Parsing Removed
// ============================================================================
// Specialists now report status explicitly via:
//   POST /api/specialists/:name/report-status
// This replaces unreliable terminal output parsing (detectSpecialistCompletion).
// ============================================================================

const PENDING_OPS_FILE = join(homedir(), '.panopticon', 'pending-operations.json');

function loadPendingOperations(): Record<string, PendingOperation> {
  try {
    if (existsSync(PENDING_OPS_FILE)) {
      const data = JSON.parse(readFileSync(PENDING_OPS_FILE, 'utf-8'));
      // Clean up stale operations (older than 10 minutes with running status)
      const now = Date.now();
      const tenMinutes = 10 * 60 * 1000;
      for (const key of Object.keys(data)) {
        const op = data[key];
        if (op.status === 'running' && now - new Date(op.startedAt).getTime() > tenMinutes) {
          op.status = 'failed';
          op.error = 'Operation timed out';
        }
      }
      return data;
    }
  } catch (err) {
    console.error('Failed to load pending operations:', err);
  }
  return {};
}

function savePendingOperations(ops: Record<string, PendingOperation>): void {
  try {
    const dir = dirname(PENDING_OPS_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(PENDING_OPS_FILE, JSON.stringify(ops, null, 2));
  } catch (err) {
    console.error('Failed to save pending operations:', err);
  }
}

function setPendingOperation(issueId: string, type: PendingOperation['type']): void {
  const ops = loadPendingOperations();
  ops[issueId] = {
    type,
    issueId,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  savePendingOperations(ops);
}

function completePendingOperation(issueId: string, error?: string): void {
  const ops = loadPendingOperations();
  if (ops[issueId]) {
    if (error) {
      ops[issueId].status = 'failed';
      ops[issueId].error = error;
    } else {
      // Remove successful operations after a short delay
      delete ops[issueId];
    }
    savePendingOperations(ops);
  }
}

function getPendingOperation(issueId: string): PendingOperation | null {
  const ops = loadPendingOperations();
  return ops[issueId] || null;
}

function clearPendingOperation(issueId: string): void {
  const ops = loadPendingOperations();
  delete ops[issueId];
  savePendingOperations(ops);
}

// Get the first registered project path from pan
function getDefaultProjectPath(): string {
  try {
    const projectsFile = join(homedir(), '.panopticon', 'projects.json');
    if (existsSync(projectsFile)) {
      const projects = JSON.parse(readFileSync(projectsFile, 'utf-8'));
      if (Array.isArray(projects) && projects.length > 0) {
        return projects[0].path;
      }
    }
  } catch {}
  return homedir();
}

// Spawn a pan command and track its output
function spawnPanCommand(args: string[], description: string, cwd?: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();
  const command = `pan ${args.join(' ')}`;
  const workingDir = cwd || homedir();

  logActivity({
    id,
    timestamp,
    command,
    status: 'running',
    output: [`[${timestamp}] Starting: ${command}`, `[cwd] ${workingDir}`],
  });

  const child = spawn('pan', args, {
    cwd: workingDir,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  child.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => appendActivityOutput(id, line));
  });

  child.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l: string) => l.trim());
    lines.forEach((line: string) => appendActivityOutput(id, `[stderr] ${line}`));
  });

  child.on('close', (code) => {
    const status = code === 0 ? 'completed' : 'failed';
    appendActivityOutput(id, `[${new Date().toISOString()}] Process exited with code ${code}`);
    updateActivity(id, { status });
  });

  child.on('error', (err) => {
    appendActivityOutput(id, `[error] ${err.message}`);
    updateActivity(id, { status: 'failed' });
  });

  return id;
}

const app = express();
// Support both DASHBOARD_PORT (preferred) and PORT for backward compatibility
const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3011', 10);

app.use(cors());
app.use(express.json());

// Load Linear API key from ~/.panopticon.env or environment
function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

// Rally configuration
interface RallyConfig {
  apiKey: string;
  server?: string;
  workspace?: string;
  project?: string;
}

function getRallyConfig(): RallyConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;

  const content = readFileSync(envFile, 'utf-8');

  // Look for RALLY_API_KEY
  const apiKeyMatch = content.match(/RALLY_API_KEY=(.+)/);
  if (!apiKeyMatch) return null;

  const apiKey = apiKeyMatch[1].trim();

  // Optional: RALLY_SERVER
  const serverMatch = content.match(/RALLY_SERVER=(.+)/);
  const server = serverMatch?.[1].trim();

  // Optional: RALLY_WORKSPACE
  const workspaceMatch = content.match(/RALLY_WORKSPACE=(.+)/);
  const workspace = workspaceMatch?.[1].trim();

  // Optional: RALLY_PROJECT
  const projectMatch = content.match(/RALLY_PROJECT=(.+)/);
  const project = projectMatch?.[1].trim();

  return { apiKey, server, workspace, project };
}

// GitHub configuration
interface GitHubConfig {
  token: string;
  repos: Array<{ owner: string; repo: string; prefix?: string }>;
}

function getGitHubConfig(): GitHubConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;

  const content = readFileSync(envFile, 'utf-8');

  // Look for GITHUB_TOKEN
  const tokenMatch = content.match(/GITHUB_TOKEN=(.+)/);
  if (!tokenMatch) return null;

  const token = tokenMatch[1].trim();

  // Look for GITHUB_REPOS (format: owner/repo,owner/repo:PREFIX)
  const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
  if (!reposMatch) return null;

  const repos = reposMatch[1].trim().split(',').map(r => {
    const [repoPath, prefix] = r.trim().split(':');
    const [owner, repo] = repoPath.split('/');
    return { owner, repo, prefix };
  }).filter(r => r.owner && r.repo);

  if (repos.length === 0) return null;

  return { token, repos };
}

// Get GitHub local paths mapping
function getGitHubLocalPaths(): Record<string, string> {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return {};

  const content = readFileSync(envFile, 'utf-8');
  const match = content.match(/GITHUB_LOCAL_PATHS=(.+)/);
  if (!match) return {};

  return Object.fromEntries(
    match[1].trim().split(',').filter(Boolean).map(p => {
      const [repo, path] = p.split('=');
      return [repo, path];
    })
  );
}

// ============================================================================
// AskUserQuestion Interception Helpers (PAN-20)
// ============================================================================

/**
 * Get workspace path from agent state file
 * Agent state is stored in ~/.panopticon/agents/<agent-id>/state.json
 */
function getAgentWorkspace(agentId: string): string | null {
  const stateFile = join(homedir(), '.panopticon', 'agents', agentId, 'state.json');
  if (!existsSync(stateFile)) return null;
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    return state.workspace || null;
  } catch {
    return null;
  }
}

/**
 * Get workspace info for an issue, detecting remote vs local workspaces
 * Returns info about where the workspace exists and how to access it
 */
interface WorkspaceInfo {
  exists: boolean;
  isRemote: boolean;
  vmName?: string;
  remotePath?: string;  // Path on the remote VM (usually /workspace)
  localPath?: string;   // Path on local machine
  agentId?: string;     // The agent ID if a remote agent is associated
}

function getWorkspaceInfoForIssue(issueId: string): WorkspaceInfo {
  const issueLower = issueId.toLowerCase();
  const agentId = `agent-${issueLower}`;

  // Check for remote agent first
  const remoteStateFile = join(homedir(), '.panopticon', 'agents', agentId, 'remote-state.json');
  if (existsSync(remoteStateFile)) {
    try {
      const state = JSON.parse(readFileSync(remoteStateFile, 'utf-8'));
      if (state.location === 'remote' && state.vmName) {
        return {
          exists: true,
          isRemote: true,
          vmName: state.vmName,
          remotePath: '/workspace',  // Standard remote workspace path
          agentId,
        };
      }
    } catch {
      // Ignore parse errors, fall through to local check
    }
  }

  // Check for local workspace
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const localPath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  if (existsSync(localPath)) {
    return {
      exists: true,
      isRemote: false,
      localPath,
      agentId: existsSync(join(homedir(), '.panopticon', 'agents', agentId)) ? agentId : undefined,
    };
  }

  return { exists: false, isRemote: false };
}

/**
 * Transform workspace path to Claude project directory
 * /home/user/projects/panopticon/workspaces/feature-pan-1
 * -> ~/.claude/projects/-home-user-projects-panopticon-workspaces-feature-pan-1/
 */
function getClaudeProjectDir(workspacePath: string): string {
  // Remove leading slash and replace all slashes with dashes
  const dirName = workspacePath.replace(/^\//, '').replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', `-${dirName}`);
}

/**
 * Sessions index entry structure from Claude Code
 */
interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  modified: string;
}

/**
 * Get the active (most recently modified) session JSONL path for a Claude project
 * Always uses actual file mtime since sessions-index.json can be stale
 */
function getActiveSessionPath(projectDir: string): string | null {
  if (!existsSync(projectDir)) return null;

  try {
    // Find all .jsonl files and sort by actual file modification time
    // This is more reliable than sessions-index.json which can be stale
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: join(projectDir, f),
        mtime: statSync(join(projectDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  } catch {
    return null;
  }
}

/**
 * Get the JSONL session path for an agent by traversing:
 * agent ID -> state.json -> workspace -> Claude project dir -> sessions-index.json -> JSONL
 */
function getAgentJsonlPath(agentId: string): string | null {
  const workspace = getAgentWorkspace(agentId);
  if (!workspace) return null;

  const projectDir = getClaudeProjectDir(workspace);
  return getActiveSessionPath(projectDir);
}

/**
 * AskUserQuestion option structure
 */
interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Single question within an AskUserQuestion tool call
 */
interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * A pending (unanswered) AskUserQuestion from JSONL
 */
interface PendingQuestion {
  toolId: string;
  timestamp: string;
  questions: Question[];
}

/**
 * Scan a JSONL file for pending (unanswered) AskUserQuestion tool calls
 * A question is pending if there's a tool_use with name='AskUserQuestion'
 * but no corresponding tool_result with matching tool_use_id
 *
 * NOTE: Uses async file reading to avoid blocking the event loop on large JSONL files
 */
async function getPendingQuestions(jsonlPath: string): Promise<PendingQuestion[]> {
  if (!existsSync(jsonlPath)) return [];

  try {
    // Use async readFile to avoid blocking on large JSONL files
    const content = await readFile(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // Track tool calls and which ones have been answered
    const toolCalls = new Map<string, PendingQuestion>();
    const answeredIds = new Set<string>();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const messageContent = entry.message?.content;
        if (!Array.isArray(messageContent)) continue;

        for (const item of messageContent) {
          // Track AskUserQuestion tool calls
          if (item.type === 'tool_use' && item.name === 'AskUserQuestion') {
            toolCalls.set(item.id, {
              toolId: item.id,
              timestamp: entry.timestamp || new Date().toISOString(),
              questions: item.input?.questions || []
            });
          }
          // Track answered questions (tool_result)
          if (item.type === 'tool_result' && item.tool_use_id) {
            answeredIds.add(item.tool_use_id);
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    // Return only unanswered questions
    return Array.from(toolCalls.entries())
      .filter(([id]) => !answeredIds.has(id))
      .map(([, question]) => question);
  } catch {
    return [];
  }
}

/**
 * Get pending questions for an agent by ID
 */
async function getAgentPendingQuestions(agentId: string): Promise<PendingQuestion[]> {
  const jsonlPath = getAgentJsonlPath(agentId);
  if (!jsonlPath) return [];
  return getPendingQuestions(jsonlPath);
}

// Map GitHub issue state + labels to canonical state
function mapGitHubStateToCanonical(state: string, labels: string[]): string {
  // Handle both API lowercase and gh CLI uppercase
  const stateLower = state.toLowerCase();

  // Closed issues are always done (regardless of labels)
  if (stateLower === 'closed') {
    return 'done';
  }

  // For open issues, check labels for workflow state
  // Order matters: more progressed states take precedence
  const labelNames = labels.map(l => l.toLowerCase());

  // Most progressed states first
  // "done" label on OPEN issues = work complete, pending merge/closure → in_review
  // (actual "done" status only for CLOSED issues, handled above)
  if (labelNames.some(l => l === 'done' || l.includes('completed'))) {
    return 'in_review';
  }
  if (labelNames.some(l => l.includes('in review') || l.includes('in-review') || l.includes('review') || l.includes('qa'))) {
    return 'in_review';
  }
  if (labelNames.some(l => l.includes('in progress') || l.includes('in-progress') || l.includes('wip'))) {
    return 'in_progress';
  }
  // Early workflow stages
  if (labelNames.some(l => l.includes('planning') || l.includes('discovery'))) {
    return 'planning';
  }
  if (labelNames.some(l => l === 'planned')) {
    return 'planned';
  }
  if (labelNames.some(l => l.includes('backlog') || l.includes('icebox'))) {
    return 'backlog';
  }
  if (labelNames.some(l => l.includes('todo') || l.includes('ready'))) {
    return 'todo';
  }

  // Default open issues to todo
  return 'todo';
}

// Fetch GitHub issues using gh CLI for better auth
async function fetchGitHubIssues(): Promise<any[]> {
  const config = getGitHubConfig();
  if (!config) return [];

  const allIssues: any[] = [];

  for (const { owner, repo, prefix } of config.repos) {
    try {
      // Use gh CLI for fetching issues (better OAuth handling)
      let openIssues: any[] = [];
      let closedIssues: any[] = [];

      try {
        // Use async execAsync to avoid blocking event loop
        const { stdout: openJson } = await execAsync(
          `gh issue list --repo ${owner}/${repo} --state open --limit 100 --json number,title,body,state,labels,assignees,createdAt,updatedAt,url`,
          { timeout: 30000 }
        );
        openIssues = JSON.parse(openJson);
      } catch (ghError: any) {
        console.error(`gh CLI failed for ${owner}/${repo} open issues:`, ghError.message);
        // Fallback to API if gh fails
        const openResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`,
          {
            headers: {
              'Authorization': `token ${config.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Panopticon-Dashboard',
            },
          }
        );
        if (openResponse.ok) {
          openIssues = await openResponse.json();
        }
      }

      try {
        const dateFilter = getOneDayAgo().toISOString().split('T')[0]; // YYYY-MM-DD

        // Use async execAsync to avoid blocking event loop
        const { stdout: closedJson } = await execAsync(
          `gh issue list --repo ${owner}/${repo} --state closed --search "closed:>=${dateFilter}" --limit 50 --json number,title,body,state,labels,assignees,createdAt,updatedAt,closedAt,url`,
          { timeout: 30000 }
        );
        closedIssues = JSON.parse(closedJson);
      } catch (ghError: any) {
        console.error(`gh CLI failed for ${owner}/${repo} closed issues:`, ghError.message);
        // Fallback to API
        const oneDayAgo = getOneDayAgo();
        const closedResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues?state=closed&since=${oneDayAgo.toISOString()}&per_page=50`,
          {
            headers: {
              'Authorization': `token ${config.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Panopticon-Dashboard',
            },
          }
        );
        if (closedResponse.ok) {
          closedIssues = await closedResponse.json();
        }
      }

      // Combine and filter out PRs (they have pull_request key)
      const issues = [...openIssues, ...closedIssues].filter(
        (issue: any) => !issue.pull_request
      );

      // Format issues to match our schema
      // Handle both gh CLI format (camelCase) and API format (snake_case)
      for (const issue of issues) {
        const labelNames = issue.labels?.map((l: any) => l.name || l) || [];
        const canonicalStatus = mapGitHubStateToCanonical(issue.state, labelNames);

        // Create identifier: use prefix if provided, otherwise repo name
        const issuePrefix = prefix || repo.toUpperCase();
        const identifier = `${issuePrefix}-${issue.number}`;

        // Handle assignee: gh CLI uses assignees array, API uses assignee object
        const firstAssignee = issue.assignees?.[0] || issue.assignee;

        allIssues.push({
          id: `github-${owner}-${repo}-${issue.number}`,
          identifier,
          title: issue.title,
          description: issue.body || '',
          status: canonicalStatus === 'todo' ? 'Todo' :
                  canonicalStatus === 'planning' ? 'In Planning' :
                  canonicalStatus === 'planned' ? 'Planned' :
                  canonicalStatus === 'in_progress' ? 'In Progress' :
                  canonicalStatus === 'in_review' ? 'In Review' :
                  canonicalStatus === 'done' ? 'Done' :
                  canonicalStatus === 'backlog' ? 'Backlog' : 'Todo',
          priority: labelNames.some((l: string) => l.includes('priority') && l.includes('high')) ? 2 :
                    labelNames.some((l: string) => l.includes('priority') && l.includes('urgent')) ? 1 :
                    labelNames.some((l: string) => l.includes('priority') && l.includes('low')) ? 4 : 3,
          assignee: firstAssignee ? {
            name: firstAssignee.login,
            email: `${firstAssignee.login}@github`,
          } : undefined,
          labels: labelNames,
          // gh CLI uses 'url', API uses 'html_url'
          url: issue.url || issue.html_url,
          // gh CLI uses camelCase, API uses snake_case
          createdAt: issue.createdAt || issue.created_at,
          updatedAt: issue.updatedAt || issue.updated_at,
          completedAt: issue.closedAt || issue.closed_at,
          // Use repo as project
          project: {
            id: `github-${owner}-${repo}`,
            name: `${owner}/${repo}`,
            color: '#333',
            icon: 'github',
          },
          // Mark source as GitHub
          source: 'github',
          sourceRepo: `${owner}/${repo}`,
        });
      }
    } catch (error) {
      console.error(`Error fetching GitHub issues for ${owner}/${repo}:`, error);
    }
  }

  console.log(`Fetched ${allIssues.length} GitHub issues`);
  return allIssues;
}

// Map Rally ScheduleState to canonical dashboard state
function mapRallyStateToCanonical(scheduleState: string): string {
  const stateLower = scheduleState.toLowerCase();

  if (stateLower === 'defined') return 'todo';
  if (stateLower === 'in-progress') return 'in_progress';
  if (stateLower === 'completed' || stateLower === 'accepted') return 'done';

  return 'todo';
}

// Fetch Rally issues using the Rally adapter
async function fetchRallyIssues(): Promise<any[]> {
  const config = getRallyConfig();
  if (!config) return [];

  try {
    // Dynamically import the Rally tracker
    const { RallyTracker } = await import('../../lib/tracker/rally.js');

    const tracker = new RallyTracker({
      apiKey: config.apiKey,
      server: config.server,
      workspace: config.workspace,
      project: config.project,
    });

    // Fetch all open issues
    const issues = await tracker.listIssues({
      includeClosed: false,
      limit: 100,
    });

    // Format issues to match dashboard schema
    const formattedIssues = issues.map((issue: any) => {
      const canonicalStatus = mapRallyStateToCanonical(issue.state);

      return {
        id: `rally-${issue.id}`,
        identifier: issue.ref,
        title: issue.title,
        description: issue.description || '',
        status: canonicalStatus === 'todo' ? 'Todo' :
                canonicalStatus === 'in_progress' ? 'In Progress' :
                canonicalStatus === 'done' ? 'Done' : 'Todo',
        priority: issue.priority ?? 3,
        assignee: issue.assignee ? {
          name: issue.assignee,
          email: `${issue.assignee.replace(/\s+/g, '.').toLowerCase()}@rally`,
        } : undefined,
        labels: issue.labels || [],
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        project: {
          id: 'rally-project',
          name: 'Rally',
          color: '#00C7B1',
          icon: 'rally',
        },
        source: 'rally',
      };
    });

    console.log(`Fetched ${formattedIssues.length} Rally issues`);
    return formattedIssues;
  } catch (error: any) {
    console.error('Error fetching Rally issues:', error.message);
    return [];
  }
}

// Get issues from cache (IssueDataService handles background polling + push)
app.get('/api/issues', (req, res) => {
  try {
    const issues = issueDataService.getIssues({
      cycle: req.query.cycle as string,
      includeCompleted: req.query.includeCompleted === 'true',
    });
    res.json(issues);
  } catch (error: any) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues: ' + error.message });
  }
});

// Analyze issue complexity
app.get('/api/issues/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'LINEAR_API_KEY not configured' });
    }

    // Linear's issue query accepts both UUIDs and identifiers (MIN-123)
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          priority
          url
          state { name }
          labels { nodes { name } }
          project { id name }
        }
      }
    `;

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query, variables: { id } }),
    });
    const json = await response.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
    const issue = json.data?.issue;

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    // Analyze complexity
    const desc = (issue.description || '').toLowerCase();
    const title = issue.title.toLowerCase();
    const combined = `${title} ${desc}`;

    const reasons: string[] = [];
    const subsystems: string[] = [];
    let estimatedTasks = 1;

    // Check for multiple subsystems
    if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) {
      subsystems.push('frontend');
    }
    if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) {
      subsystems.push('backend');
    }
    if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) {
      subsystems.push('database');
    }
    if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) {
      subsystems.push('tests');
    }

    if (subsystems.length > 1) {
      reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
      estimatedTasks += subsystems.length;
    }

    // Check for ambiguous requirements
    const ambiguousPatterns = ['should we', 'maybe', 'or', 'consider', 'option', 'approach', 'tbd', 'unclear'];
    for (const pattern of ambiguousPatterns) {
      if (combined.includes(pattern)) {
        reasons.push('Requirements may be ambiguous');
        break;
      }
    }

    // Check for architecture keywords
    const architecturePatterns = ['refactor', 'architecture', 'redesign', 'migrate', 'integration', 'authentication'];
    for (const pattern of architecturePatterns) {
      if (combined.includes(pattern)) {
        reasons.push(`Architecture decision needed: ${pattern}`);
        estimatedTasks += 2;
        break;
      }
    }

    // Check description length
    if (desc.length > 500) {
      reasons.push('Detailed description suggests complexity');
      estimatedTasks += 1;
    }

    // Check labels for complexity hints
    const labels = issue.labels?.nodes?.map((l: any) => l.name) || [];
    const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
    for (const label of labels) {
      if (complexLabels.some(cl => label.toLowerCase().includes(cl))) {
        reasons.push(`Label indicates complexity: ${label}`);
        estimatedTasks += 2;
      }
    }

    const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

    res.json({
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.state?.name || 'Unknown',
        priority: issue.priority,
        url: issue.url,
        labels,
      },
      complexity: {
        isComplex,
        reasons,
        subsystems,
        estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
      },
    });
  } catch (error: any) {
    console.error('Error analyzing issue:', error);
    res.status(500).json({ error: 'Failed to analyze issue: ' + error.message });
  }
});

// Create execution plan for an issue
app.post('/api/issues/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { answers, tasks } = req.body;

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks are required' });
    }

    // Get issue details first
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'LINEAR_API_KEY not configured' });
    }

    // Linear's issue query accepts both UUIDs and identifiers (MIN-123)
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          url
        }
      }
    `;
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query, variables: { id } }),
    });
    const json = await response.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
    const issue = json.data?.issue;

    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    // Find project path for this issue
    const mappings = getProjectMappings();
    const prefix = issue.identifier.split('-')[0];
    const mapping = mappings.find(m => m.linearPrefix.toUpperCase() === prefix.toUpperCase());
    const projectPath = mapping?.localPath || getDefaultProjectPath();

    // Generate STATE.md content
    const stateContent = [
      `# Agent State: ${issue.identifier}`,
      '',
      `**Last Updated:** ${new Date().toISOString()}`,
      '',
      '## Current Position',
      '',
      `- **Issue:** ${issue.identifier}`,
      `- **Title:** ${issue.title}`,
      `- **Status:** Planning complete, ready for execution`,
      `- **Linear:** ${issue.url}`,
      '',
      '## Decisions Made During Planning',
      '',
    ];

    if (answers && Object.keys(answers).length > 0) {
      if (answers.scope) stateContent.push(`- **Scope:** ${answers.scope}`);
      if (answers.approach) stateContent.push(`- **Technical approach:** ${answers.approach}`);
      if (answers.edgeCases) stateContent.push(`- **Edge cases:** ${answers.edgeCases}`);
      if (answers.testing && answers.testing.length > 0) stateContent.push(`- **Testing:** ${answers.testing.join(', ')}`);
      if (answers.outOfScope) stateContent.push(`- **Out of scope:** ${answers.outOfScope}`);
    } else {
      stateContent.push('- No specific decisions recorded');
    }

    stateContent.push('');
    stateContent.push('## Planned Tasks');
    stateContent.push('');

    for (const task of tasks) {
      stateContent.push(`- [ ] ${task.name}${task.dependsOn ? ` (after: ${task.dependsOn})` : ''}`);
    }

    stateContent.push('');
    stateContent.push('## Blockers/Concerns');
    stateContent.push('');
    stateContent.push('- None identified during planning');
    stateContent.push('');
    stateContent.push('## Notes');
    stateContent.push('');
    stateContent.push('<!-- Add notes as work progresses -->');
    stateContent.push('');

    // Generate WORKSPACE.md content
    const workspaceContent = [
      `# Workspace: ${issue.identifier}`,
      '',
      `> ${issue.title}`,
      '',
      '## Quick Links',
      '',
      `- [Linear Issue](${issue.url})`,
      '',
      '## Context Files',
      '',
      '- `STATE.md` - Current progress and decisions',
      '- `WORKSPACE.md` - This file',
      '',
      '## Beads',
      '',
      'Check current task status:',
      '```bash',
      'bd ready  # Next actionable task',
      `bd list --tag ${issue.identifier}  # All tasks for this issue`,
      '```',
      '',
      '## Agent Instructions',
      '',
      '1. Run `bd ready` to get next task',
      '2. Complete the task following relevant skills',
      '3. Run `bd close "<task name>" --reason "..."` when done',
      '4. Update STATE.md with progress',
      '5. Repeat until all tasks complete',
      '',
    ];

    // Write files to .planning directory
    const { mkdirSync, writeFileSync: writeSync } = require('fs');
    const planningDir = join(projectPath, '.planning');
    mkdirSync(planningDir, { recursive: true });

    const statePath = join(planningDir, 'STATE.md');
    const workspacePath = join(planningDir, 'WORKSPACE.md');
    writeSync(statePath, stateContent.join('\n'));
    writeSync(workspacePath, workspaceContent.join('\n'));

    // Copy to PRD directory
    let prdPath: string | undefined;
    try {
      const prdDir = join(projectPath, 'docs', 'prds', 'active');
      mkdirSync(prdDir, { recursive: true });
      prdPath = join(prdDir, `${issue.identifier.toLowerCase()}-plan.md`);
      writeSync(prdPath, stateContent.join('\n'));
    } catch {
      // PRD copy is optional
    }

    // Create Beads tasks
    const beadsResult = { success: false, created: [] as string[], errors: [] as string[] };
    try {
      const { stdout: bdPath } = await execAsync('which bd', { encoding: 'utf-8' });
      if (bdPath.trim()) {
        const taskIds = new Map<string, string>();

        for (const task of tasks) {
          const fullName = `${issue.identifier}: ${task.name}`;
          try {
            let cmd = `bd create "${fullName.replace(/"/g, '\\"')}" --type task -l "${issue.identifier},linear"`;

            if (task.dependsOn) {
              const depName = `${issue.identifier}: ${task.dependsOn}`;
              const depId = taskIds.get(depName);
              if (depId) {
                cmd += ` --deps "blocks:${depId}"`;
              }
            }

            if (task.description) {
              cmd += ` -d "${task.description.replace(/"/g, '\\"')}"`;
            }

            const { stdout: result } = await execAsync(cmd, { encoding: 'utf-8', cwd: projectPath });
            const idMatch = result.match(/bd-[a-f0-9]+/i) || result.match(/([a-f0-9-]{8,})/i);
            if (idMatch) {
              taskIds.set(fullName, idMatch[0]);
            }
            beadsResult.created.push(fullName);
          } catch (error: any) {
            beadsResult.errors.push(`Failed to create "${task.name}": ${error.message}`);
          }
        }

        if (beadsResult.created.length > 0) {
          try {
            await execAsync('bd flush', { encoding: 'utf-8', cwd: projectPath });
          } catch {}
        }

        beadsResult.success = beadsResult.errors.length === 0;
      }
    } catch {
      beadsResult.errors.push('bd (beads) CLI not found');
    }

    res.json({
      success: true,
      complexity: null, // Not re-analyzed
      tasks,
      files: {
        state: statePath.replace(projectPath, '.'),
        workspace: workspacePath.replace(projectPath, '.'),
        prd: prdPath ? prdPath.replace(projectPath, '.') : undefined,
      },
      beads: beadsResult,
    });
  } catch (error: any) {
    console.error('Error creating plan:', error);
    res.status(500).json({ error: 'Failed to create plan: ' + error.message });
  }
});

// Get project mappings (Linear project -> local directory)
const PROJECT_MAPPINGS_FILE = join(homedir(), '.panopticon', 'project-mappings.json');

interface ProjectMapping {
  linearProjectId: string;
  linearProjectName: string;
  linearPrefix: string;  // e.g., "MIN"
  localPath: string;
}

function getProjectMappings(): ProjectMapping[] {
  try {
    if (existsSync(PROJECT_MAPPINGS_FILE)) {
      return JSON.parse(readFileSync(PROJECT_MAPPINGS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveProjectMappings(mappings: ProjectMapping[]) {
  const dir = join(homedir(), '.panopticon');
  if (!existsSync(dir)) {
    require('fs').mkdirSync(dir, { recursive: true });
  }
  writeFileSync(PROJECT_MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
}

// Get all project mappings
app.get('/api/project-mappings', (_req, res) => {
  res.json(getProjectMappings());
});

// Update project mappings
app.put('/api/project-mappings', (req, res) => {
  const mappings = req.body;
  if (!Array.isArray(mappings)) {
    return res.status(400).json({ error: 'Expected array of mappings' });
  }
  saveProjectMappings(mappings);
  res.json({ success: true, mappings });
});

// Add or update a single project mapping
app.post('/api/project-mappings', (req, res) => {
  const { linearProjectId, linearProjectName, linearPrefix, localPath } = req.body;
  if (!linearProjectId || !localPath) {
    return res.status(400).json({ error: 'linearProjectId and localPath required' });
  }

  const mappings = getProjectMappings();
  const existing = mappings.findIndex(m => m.linearProjectId === linearProjectId);

  const mapping: ProjectMapping = {
    linearProjectId,
    linearProjectName: linearProjectName || '',
    linearPrefix: linearPrefix || '',
    localPath,
  };

  if (existing >= 0) {
    mappings[existing] = mapping;
  } else {
    mappings.push(mapping);
  }

  saveProjectMappings(mappings);
  res.json({ success: true, mapping });
});

// Get local path for a Linear project (used when creating workspaces)
// Now integrates with YAML-based project registry (projects.yaml) as primary source
function getProjectPath(linearProjectId?: string, issuePrefix?: string, issueLabels?: string[]): string {
  // First, try the new YAML-based project registry (preferred)
  // This supports label-based routing for multi-repo projects like MYN
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`; // Construct a dummy issue ID for resolution
    const resolved = resolveProjectFromIssue(issueId, issueLabels || []);
    if (resolved) {
      return resolved.projectPath;
    }
  }

  // Fall back to legacy JSON mappings
  const mappings = getProjectMappings();

  // Try to find by project ID first
  if (linearProjectId) {
    const mapping = mappings.find(m => m.linearProjectId === linearProjectId);
    if (mapping) return mapping.localPath;
  }

  // Try to find by issue prefix (e.g., "MIN" from "MIN-645")
  if (issuePrefix) {
    const mapping = mappings.find(m => m.linearPrefix === issuePrefix);
    if (mapping) return mapping.localPath;
  }

  // Handle GitHub issue prefixes from GITHUB_REPOS config
  // Format: owner/repo:PREFIX or owner/repo (uses uppercase repo name)
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        // Match against prefix or uppercase repo name
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          // GitHub repos - look in ~/projects/{repo}/ or ~/projects/{owner}/{repo}/
          const possiblePaths = [
            join(homedir(), 'projects', repo),
            join(homedir(), 'projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) {
              return path;
            }
          }
        }
      }
    }
  }

  // Fall back to default project
  return getDefaultProjectPath();
}

// Get git status for a workspace path (ASYNC - non-blocking)
async function getGitStatusAsync(workspacePath: string): Promise<{ branch: string; uncommittedFiles: number; latestCommit: string } | null> {
  try {
    if (!existsSync(workspacePath)) return null;

    // Run all git commands in parallel for better performance
    const [branchResult, uncommittedResult, commitResult] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""', { cwd: workspacePath }),
      execAsync('git status --porcelain 2>/dev/null | wc -l', { cwd: workspacePath }),
      execAsync('git log -1 --pretty=format:"%s" 2>/dev/null || echo ""', { cwd: workspacePath }),
    ]);

    const branch = branchResult.stdout.trim();
    const uncommitted = uncommittedResult.stdout.trim();
    const latestCommit = commitResult.stdout.trim();

    if (!branch) return null;

    return {
      branch,
      uncommittedFiles: parseInt(uncommitted) || 0,
      latestCommit: latestCommit.slice(0, 60) + (latestCommit.length > 60 ? '...' : ''),
    };
  } catch {
    return null;
  }
}

// Async version for non-blocking git operations
async function getGitStatus(workspacePath: string): Promise<{ branch: string; uncommittedFiles: number; latestCommit: string } | null> {
  try {
    if (!existsSync(workspacePath)) return null;

    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });

    const { stdout: uncommitted } = await execAsync('git status --porcelain 2>/dev/null | wc -l', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });

    const { stdout: latestCommit } = await execAsync('git log -1 --pretty=format:"%s" 2>/dev/null', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });

    return {
      branch: branch.trim(),
      uncommittedFiles: parseInt(uncommitted.trim()) || 0,
      latestCommit: latestCommit.trim().slice(0, 60) + (latestCommit.trim().length > 60 ? '...' : ''),
    };
  } catch {
    return null;
  }
}

/**
 * Get workspace location (local or remote) for an issue
 * Checks ~/.panopticon/workspaces/{issueId}.yaml for metadata
 */
function getWorkspaceLocation(issueId: string): 'local' | 'remote' | undefined {
  try {
    const workspacesDir = join(homedir(), '.panopticon', 'workspaces');
    // Try various case variations
    const variations = [
      issueId.toLowerCase(),
      issueId.toUpperCase(),
      issueId,
    ];

    for (const id of variations) {
      const metadataFile = join(workspacesDir, `${id}.yaml`);
      if (existsSync(metadataFile)) {
        const content = readFileSync(metadataFile, 'utf-8');
        // Simple YAML parsing for location field
        const locationMatch = content.match(/^location:\s*(local|remote)\s*$/m);
        if (locationMatch) {
          return locationMatch[1] as 'local' | 'remote';
        }
      }
    }
    return undefined; // No workspace metadata found
  } catch {
    return undefined;
  }
}

// Get running agents from tmux sessions
app.get('/api/agents', async (_req, res) => {
  try {
    const now = Date.now();

    // Return cached data if still fresh
    if (agentsCache.data && (now - agentsCache.timestamp) < AGENTS_CACHE_TTL_MS) {
      return res.json(agentsCache.data);
    }

    // Get local tmux sessions
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_created}" 2>/dev/null || true');

    const agentLines = stdout
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('agent-') || line.startsWith('planning-'));

    // Also check for remote agents from state files
    const agentsDir = join(homedir(), '.panopticon', 'agents');
    const remoteAgentIds: string[] = [];
    if (existsSync(agentsDir)) {
      const dirs = readdirSync(agentsDir).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
      for (const dir of dirs) {
        const remoteStateFile = join(agentsDir, dir, 'remote-state.json');
        if (existsSync(remoteStateFile)) {
          try {
            const state = JSON.parse(readFileSync(remoteStateFile, 'utf-8'));
            if (state.location === 'remote' && state.status === 'running') {
              // Check if not already in local list
              if (!agentLines.some(line => line.startsWith(dir + '|'))) {
                remoteAgentIds.push(dir);
              }
            }
          } catch {}
        }
      }
    }

    // Process agents in parallel to avoid blocking
    const agents = await Promise.all(
      agentLines.map(async (line) => {
        const [name, created] = line.split('|');
        const startedAt = new Date(parseInt(created) * 1000).toISOString();
        const isPlanning = name.startsWith('planning-');

        // Check agent state from ~/.panopticon/agents/
        const stateFile = join(homedir(), '.panopticon', 'agents', name, 'state.json');
        const healthFile = join(homedir(), '.panopticon', 'agents', name, 'health.json');
        let state: any = { runtime: 'claude', model: isPlanning ? 'opus' : 'sonnet', workspace: process.cwd() };
        let health: any = { consecutiveFailures: 0, killCount: 0 };

        if (existsSync(stateFile)) {
          try {
            state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf-8')) };
          } catch {}
        }

        if (existsSync(healthFile)) {
          try {
            health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
          } catch {}
        }

        // Get git status for workspace (ASYNC - doesn't block event loop)
        const gitStatus = state.workspace ? await getGitStatusAsync(state.workspace) : null;

        // Extract issue ID from session name
        const issueId = isPlanning
          ? name.replace('planning-', '').toUpperCase()
          : name.replace('agent-', '').toUpperCase();

        // Check for pending AskUserQuestion (agent waiting for user input)
        const pendingQuestions = await getAgentPendingQuestions(name);

        // Check workspace location (local vs remote)
        const workspaceLocation = getWorkspaceLocation(issueId);

        return {
          id: name,
          issueId,
          runtime: state.runtime || 'claude',
          model: state.model || (isPlanning ? 'opus' : 'sonnet'),
          status: 'healthy' as const,
          startedAt,
          consecutiveFailures: health.consecutiveFailures || 0,
          killCount: health.killCount || 0,
          workspace: state.workspace || null,
          workspaceLocation,
          git: gitStatus,
          type: isPlanning ? 'planning' : 'agent',
          hasPendingQuestion: pendingQuestions.length > 0,
          pendingQuestionCount: pendingQuestions.length,
        };
      })
    );

    // Process remote agents from state files
    const remoteAgents = await Promise.all(
      remoteAgentIds.map(async (name) => {
        const remoteStateFile = join(homedir(), '.panopticon', 'agents', name, 'remote-state.json');
        const isPlanning = name.startsWith('planning-');

        try {
          const state = JSON.parse(readFileSync(remoteStateFile, 'utf-8'));
          const issueId = state.issueId?.toUpperCase() || name.replace(/^(agent-|planning-)/, '').toUpperCase();

          // Check workspace location
          const workspaceLocation = getWorkspaceLocation(issueId);

          return {
            id: name,
            issueId,
            runtime: 'claude',
            model: state.model || (isPlanning ? 'opus' : 'sonnet'),
            status: 'healthy' as const,
            startedAt: state.startedAt || new Date().toISOString(),
            consecutiveFailures: 0,
            killCount: 0,
            workspace: `/workspace (${state.vmName})`,
            workspaceLocation: 'remote',
            vmName: state.vmName,
            git: null,
            type: isPlanning ? 'planning' : 'agent',
            hasPendingQuestion: false,
            pendingQuestionCount: 0,
            remote: true,
          };
        } catch {
          return null;
        }
      })
    );

    // Include recently-stopped agents so users can still view their logs
    const stoppedAgents: any[] = [];
    if (existsSync(agentsDir)) {
      const allDirs = readdirSync(agentsDir).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
      const alreadyListed = new Set([
        ...agentLines.map(l => l.split('|')[0]),
        ...remoteAgentIds,
      ]);

      for (const dir of allDirs) {
        if (alreadyListed.has(dir)) continue;
        const stateFile = join(agentsDir, dir, 'state.json');
        if (!existsSync(stateFile)) continue;

        try {
          const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
          if (state.status !== 'stopped') continue;

          // Only show agents stopped within the last hour
          const stoppedAt = state.lastActivity ? new Date(state.lastActivity) : null;
          if (stoppedAt && (now - stoppedAt.getTime()) > 60 * 60 * 1000) continue;

          const isPlanning = dir.startsWith('planning-');
          const issueId = state.issueId?.toUpperCase() ||
            (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();

          stoppedAgents.push({
            id: dir,
            issueId,
            runtime: state.runtime || 'claude',
            model: state.model || (isPlanning ? 'opus' : 'sonnet'),
            status: 'stopped' as const,
            startedAt: state.startedAt || new Date().toISOString(),
            consecutiveFailures: 0,
            killCount: 0,
            workspace: state.workspace || null,
            workspaceLocation: 'local',
            git: null,
            type: isPlanning ? 'planning' : 'agent',
            hasPendingQuestion: false,
            pendingQuestionCount: 0,
          });
        } catch {
          // Skip corrupted state files
        }
      }
    }

    // Combine local, remote, and recently-stopped agents
    const allAgents = [...agents, ...remoteAgents.filter(Boolean), ...stoppedAgents];

    // Cache the result
    agentsCache = { data: allAgents, timestamp: now };
    res.json(allAgents);
  } catch (error) {
    console.error('Error listing agents:', error);
    res.json([]);
  }
});

// Get agent output
app.get('/api/agents/:id/output', async (req, res) => {
  const { id } = req.params;
  const lines = req.query.lines || 100;

  try {
    // Check if this is a remote agent
    const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
    const remoteStateFile = join(agentStateDir, 'remote-state.json');

    let isRemote = false;
    let vmName = '';

    if (existsSync(remoteStateFile)) {
      try {
        const state = JSON.parse(readFileSync(remoteStateFile, 'utf-8'));
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
        }
      } catch {
        // Ignore parse errors
      }
    }

    let stdout: string;
    if (isRemote && vmName) {
      // Capture output from remote VM via SSH
      const result = await execAsync(
        `ssh -A ${vmName}.exe.xyz "tmux capture-pane -t '${id}' -p -S -${lines} 2>/dev/null || echo 'Session not found'"`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
      );
      stdout = result.stdout;
    } else {
      // Local tmux capture
      const result = await execAsync(
        `tmux capture-pane -t "${id}" -p -S -${lines} 2>/dev/null || echo "Session not found"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = result.stdout;
    }

    // If tmux returned nothing useful, fall back to saved output log
    if (!stdout || stdout.trim() === '' || stdout.trim() === 'Session not found') {
      const savedLog = join(agentStateDir, 'output.log');
      if (existsSync(savedLog)) {
        const logContent = readFileSync(savedLog, 'utf-8');
        // Return the last N lines from the saved log
        const logLines = logContent.split('\n');
        const numLines = typeof lines === 'string' ? parseInt(lines, 10) : lines as number;
        stdout = logLines.slice(-numLines).join('\n');
      }
    }

    res.json({ output: stdout });
  } catch (error) {
    // Even on error, try the saved log
    try {
      const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
      const savedLog = join(agentStateDir, 'output.log');
      if (existsSync(savedLog)) {
        const logContent = readFileSync(savedLog, 'utf-8');
        res.json({ output: logContent });
        return;
      }
    } catch {
      // Fall through
    }
    res.json({ output: 'Failed to capture output' });
  }
});

// Send message to agent (async to avoid blocking event loop)
app.post('/api/agents/:id/message', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Check if this is a remote agent
    const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
    const remoteStateFile = join(agentStateDir, 'remote-state.json');

    let isRemote = false;
    let vmName = '';

    if (existsSync(remoteStateFile)) {
      try {
        const state = JSON.parse(readFileSync(remoteStateFile, 'utf-8'));
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (isRemote && vmName) {
      // Send message to remote agent via SSH
      // Use -l for literal text to avoid key interpretation issues
      const escapedMessage = message.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/"/g, '\\"');
      await execAsync(
        `ssh -A ${vmName}.exe.xyz "tmux send-keys -t '${id}' -l '${escapedMessage}' && tmux send-keys -t '${id}' Enter"`,
        { timeout: 15000 }
      );
      res.json({ success: true, remote: true });
    } else {
      const { messageAgent } = await import('../lib/agents.js');
      await messageAgent(id, message);
      res.json({ success: true });
    }
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Stop agent — captures output log, kills tmux, preserves state as "stopped"
app.delete('/api/agents/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { stopAgent } = await import('../../lib/agents.js');
    stopAgent(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error stopping agent:', error);
    res.status(500).json({ error: 'Failed to stop agent' });
  }
});

// Get health history for an agent (last 24h by default)
app.get('/api/agents/:id/health-history', async (req, res) => {
  const { id } = req.params;
  const { hours = '24' } = req.query;

  try {
    const { getHealthHistory } = await import('../../lib/cloister/database.js');

    // Calculate time range
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseInt(hours as string) * 60 * 60 * 1000);

    const events = getHealthHistory(id, startTime.toISOString(), endTime.toISOString());

    res.json({
      agentId: id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      events,
    });
  } catch (error) {
    console.error('Error fetching health history:', error);
    res.status(500).json({ error: 'Failed to fetch health history' });
  }
});

// Poke an agent (send nudge message) - ASYNC to avoid blocking event loop
app.post('/api/agents/:id/poke', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  const defaultPokeMessage =
    'You seem to have been inactive for a while. If you\'re stuck:\n' +
    '1. Check your current task in STATE.md\n' +
    '2. Try an alternative approach if blocked\n' +
    '3. Ask for help if needed\n\n' +
    'What\'s your current status?';

  const pokeMsg = message || defaultPokeMessage;

  try {
    const { messageAgent } = await import('../lib/agents.js');
    await messageAgent(id, pokeMsg);
    res.json({ success: true, message: 'Agent poked successfully' });
  } catch (error) {
    console.error('Error poking agent:', error);
    res.status(500).json({ error: 'Failed to poke agent' });
  }
});

// ============================================================================
// AskUserQuestion Interception Endpoints (PAN-20)
// ============================================================================

// Get pending questions for an agent (polls JSONL for unanswered AskUserQuestion calls)
app.get('/api/agents/:id/pending-questions', async (req, res) => {
  const { id } = req.params;

  try {
    const questions = await getAgentPendingQuestions(id);
    res.json({
      pending: questions.length > 0,
      questions
    });
  } catch (error) {
    console.error('Error checking pending questions:', error);
    res.json({ pending: false, questions: [] });
  }
});

// Submit answer to a pending question (sends keystrokes to tmux session)
// ASYNC to avoid blocking event loop
app.post('/api/agents/:id/answer-question', async (req, res) => {
  const { id } = req.params;
  const { answers } = req.body; // Array of selected option labels (one per question)

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers array required' });
  }

  try {
    // Get the pending questions to map labels to option indices
    const pendingQuestions = await getAgentPendingQuestions(id);
    if (pendingQuestions.length === 0) {
      return res.status(400).json({ error: 'No pending questions found' });
    }

    const questionSet = pendingQuestions[0]; // Most recent question set
    const questions = questionSet.questions;

    // Claude's AskUserQuestion UI:
    // - Number key (1-4) selects an option for current question
    // - Tab moves to next question
    // - When on Submit, Enter submits all answers

    // Helper for small delay (non-blocking)
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < answers.length && i < questions.length; i++) {
      const answer = answers[i];
      const question = questions[i];

      // Find the 1-based index of the selected option
      const optionIndex = question.options.findIndex(
        (opt: { label: string }) => opt.label === answer
      );

      if (optionIndex === -1) {
        // Answer not found in options - might be custom text (option 4)
        // Send "4" to select "Type something" then type the answer
        await execAsync(`tmux send-keys -t "${id}" "4"`);
        // Small delay then type the custom answer
        const escapedAnswer = answer.replace(/'/g, "'\\''");
        await execAsync(`tmux send-keys -t "${id}" '${escapedAnswer}'`);
        await execAsync(`tmux send-keys -t "${id}" C-m`);
      } else {
        // Send the number key (1-based index)
        const keyNumber = optionIndex + 1;
        await execAsync(`tmux send-keys -t "${id}" "${keyNumber}"`);
      }

      // Tab to next question (or to Submit if last)
      await execAsync(`tmux send-keys -t "${id}" Tab`);

      // Small delay between keystrokes for reliability (non-blocking)
      await delay(100);
    }

    // Press Enter to submit (should be on Submit button now)
    await execAsync(`tmux send-keys -t "${id}" C-m`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending answer:', error);
    res.status(500).json({ error: 'Failed to send answer' });
  }
});

// ============================================================================
// Agent State Management Endpoints (PAN-80)
// ============================================================================

// Receive heartbeat from hooks (PreToolUse, Stop)
app.post('/api/agents/:id/heartbeat', async (req, res) => {
  const { id } = req.params;
  const { state, tool, timestamp } = req.body;

  try {
    // Update runtime state
    saveAgentRuntimeState(id, {
      state,
      lastActivity: timestamp || new Date().toISOString(),
      currentTool: tool,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving heartbeat:', error);
    res.status(500).json({ error: 'Failed to save heartbeat' });
  }
});

// Get activity log for an agent
app.get('/api/agents/:id/activity', (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;

  try {
    const activity = getActivity(id, limit);
    res.json({ activity });
  } catch (error) {
    console.error('Error reading activity:', error);
    res.status(500).json({ error: 'Failed to read activity' });
  }
});

// Suspend an agent (save session ID, kill tmux)
app.post('/api/agents/:id/suspend', async (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.body;

  try {
    // Get current session ID from API call or try to read from hook state
    const effectiveSessionId = sessionId || getSessionId(id);

    if (!effectiveSessionId) {
      return res.status(400).json({ error: 'Session ID required for suspend' });
    }

    // Save session ID for later resume
    saveSessionId(id, effectiveSessionId);

    // Kill tmux session
    await execAsync(`tmux kill-session -t "${id}" 2>/dev/null || true`);

    // Update state
    saveAgentRuntimeState(id, {
      state: 'suspended',
      suspendedAt: new Date().toISOString(),
      sessionId: effectiveSessionId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error suspending agent:', error);
    res.status(500).json({ error: 'Failed to suspend agent' });
  }
});

// Resume a suspended agent
app.post('/api/agents/:id/resume', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body; // Optional message to send after resume

  try {
    const result = await resumeAgent(id, message);

    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error resuming agent:', error);
    res.status(500).json({ error: 'Failed to resume agent' });
  }
});

// Get agent health status (ASYNC - doesn't block event loop)
app.get('/api/health/agents', async (_req, res) => {
  try {
    const agentsDir = join(homedir(), '.panopticon', 'agents');
    if (!existsSync(agentsDir)) {
      return res.json([]);
    }

    const agentNames = readdirSync(agentsDir).filter((name) =>
      name.startsWith('agent-') || name.startsWith('planning-')
    );

    // Process agents in parallel to avoid blocking
    const agents = await Promise.all(
      agentNames.map(async (name) => {
        const stateFile = join(agentsDir, name, 'state.json');
        const healthFile = join(agentsDir, name, 'health.json');

        // Get stored health info
        let storedHealth = {
          consecutiveFailures: 0,
          killCount: 0,
        };
        if (existsSync(healthFile)) {
          try {
            storedHealth = { ...storedHealth, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
          } catch {}
        }

        // Check live status (ASYNC)
        const healthStatus = await determineHealthStatusAsync(name, stateFile);

        // Filter out agents that should be hidden (completed/stopped)
        if (!healthStatus) {
          return null;
        }

        return {
          agentId: name,
          status: healthStatus.status,
          reason: healthStatus.reason,
          lastPing: new Date().toISOString(),
          consecutiveFailures: storedHealth.consecutiveFailures,
          killCount: storedHealth.killCount,
        };
      })
    );

    // Filter out null results (hidden agents)
    const visibleAgents = agents.filter((agent) => agent !== null);

    res.json(visibleAgents);
  } catch (error) {
    console.error('Error fetching health:', error);
    res.json([]);
  }
});

// Ping an agent to check if it's responsive (ASYNC)
app.post('/api/health/agents/:id/ping', async (req, res) => {
  const { id } = req.params;
  const health = await checkAgentHealthAsync(id);

  if (!health.alive) {
    return res.json({ success: false, status: 'dead' });
  }

  // Update last ping time in state file
  const stateFile = join(homedir(), '.panopticon', 'agents', id, 'state.json');
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      state.lastPing = new Date().toISOString();
      require('fs').writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch {}
  }

  res.json({ success: true, status: 'healthy', hasOutput: !!health.lastOutput });
});

// ============== Cloister API ==============

// Get Cloister status
app.get('/api/cloister/status', (_req, res) => {
  try {
    const service = getCloisterService();
    const status = service.getStatus();
    res.json(status);
  } catch (error: any) {
    console.error('Error getting Cloister status:', error);
    res.status(500).json({ error: 'Failed to get Cloister status: ' + error.message });
  }
});

// Start Cloister
app.post('/api/cloister/start', async (_req, res) => {
  try {
    const service = getCloisterService();
    await service.start();
    res.json({ success: true, message: 'Cloister started' });
  } catch (error: any) {
    console.error('Error starting Cloister:', error);
    res.status(500).json({ error: 'Failed to start Cloister: ' + error.message });
  }
});

// Stop Cloister (monitoring only, does NOT kill agents)
app.post('/api/cloister/stop', (_req, res) => {
  try {
    const service = getCloisterService();
    service.stop();
    res.json({ success: true, message: 'Cloister stopped (agents still running)' });
  } catch (error: any) {
    console.error('Error stopping Cloister:', error);
    res.status(500).json({ error: 'Failed to stop Cloister: ' + error.message });
  }
});

// Emergency stop - kill ALL agents
app.post('/api/cloister/emergency-stop', (_req, res) => {
  try {
    const service = getCloisterService();
    const killedAgents = service.emergencyStop();
    res.json({
      success: true,
      message: 'Emergency stop executed',
      killedAgents,
    });
  } catch (error: any) {
    console.error('Error executing emergency stop:', error);
    res.status(500).json({ error: 'Failed to execute emergency stop: ' + error.message });
  }
});

// Resume spawns after mass death (PAN-33)
app.post('/api/cloister/resume-spawns', (_req, res) => {
  try {
    const service = getCloisterService();
    service.resumeSpawns();
    res.json({ success: true, message: 'Agent spawns resumed' });
  } catch (error: any) {
    console.error('Error resuming spawns:', error);
    res.status(500).json({ error: 'Failed to resume spawns: ' + error.message });
  }
});

// Check if spawns are paused (PAN-33)
app.get('/api/cloister/spawn-status', (_req, res) => {
  try {
    const service = getCloisterService();
    const isPaused = service.isSpawnPaused();
    res.json({ spawnsPaused: isPaused });
  } catch (error: any) {
    console.error('Error checking spawn status:', error);
    res.status(500).json({ error: 'Failed to check spawn status: ' + error.message });
  }
});

// Get settings (PAN-78)
app.get('/api/settings', (_req, res) => {
  try {
    const settings = loadSettingsApi();
    res.json(settings);
  } catch (error: any) {
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Failed to load settings: ' + error.message });
  }
});

// Get available models (filtered by configured API keys) (PAN-78)
app.get('/api/settings/available-models', (_req, res) => {
  try {
    const settings = loadSettingsApi();
    const availableModels = getAvailableModelsApi(settings);
    res.json(availableModels);
  } catch (error: any) {
    console.error('Error loading available models:', error);
    res.status(500).json({ error: 'Failed to load available models: ' + error.message });
  }
});

// Get optimal defaults (research-based model assignments)
app.get('/api/settings/optimal-defaults', (_req, res) => {
  try {
    const optimalDefaults = getOptimalDefaultsApi();
    res.json(optimalDefaults);
  } catch (error: any) {
    console.error('Error getting optimal defaults:', error);
    res.status(500).json({ error: 'Failed to get optimal defaults: ' + error.message });
  }
});

// Model ID to API model ID mapping
const MODEL_API_IDS: Record<string, { apiModel: string; endpoint?: string }> = {
  // OpenAI models
  'gpt-5.2-codex': { apiModel: 'gpt-4o' }, // Use gpt-4o for testing (codex may not be available)
  'o3-deep-research': { apiModel: 'gpt-4o' }, // Use gpt-4o for testing
  'gpt-4o': { apiModel: 'gpt-4o' },
  'gpt-4o-mini': { apiModel: 'gpt-4o-mini' },
  'o1': { apiModel: 'gpt-4o' }, // o1 may not be available, use gpt-4o for testing
  'o3-mini': { apiModel: 'gpt-4o-mini' }, // Use mini for testing
  // Google models
  'gemini-3-pro-preview': { apiModel: 'gemini-1.5-pro' },
  'gemini-3-flash-preview': { apiModel: 'gemini-1.5-flash' },
  'gemini-2.5-pro': { apiModel: 'gemini-1.5-pro' },
  'gemini-2.5-flash': { apiModel: 'gemini-1.5-flash' },
  // Kimi models
  'kimi-k2': { apiModel: 'moonshot-v1-8k' },
  'kimi-k2.5': { apiModel: 'moonshot-v1-32k' },
  'kimi-k2-turbo': { apiModel: 'moonshot-v1-8k' }, // Use 8k for turbo testing
  // Z.AI models
  'glm-4.7': { apiModel: 'glm-4' },
  'glm-4.7-flash': { apiModel: 'glm-4-flash' },
  'glm-4-plus': { apiModel: 'glm-4' },
  'glm-4-air': { apiModel: 'glm-4-air' },
  'glm-4-flash': { apiModel: 'glm-4-flash' },
  'glm-4-long': { apiModel: 'glm-4-long' },
};

// Test API key with 2+3=5 calculation (supports specific model testing)
app.post('/api/settings/test-api-key', async (req, res) => {
  try {
    const { provider, apiKey, model } = req.body;

    if (!provider || !apiKey) {
      res.status(400).json({ error: 'Provider and apiKey are required' });
      return;
    }

    let success = false;
    let error: string | null = null;
    let response: string | null = null;
    let latencyMs = 0;
    const testPrompt = 'What is 2+3? Reply with just the number.';
    const expectedAnswer = '5';

    const startTime = Date.now();

    switch (provider) {
      case 'openai': {
        const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'gpt-4o-mini') : 'gpt-4o-mini';
        try {
          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: apiModel,
              messages: [{ role: 'user', content: testPrompt }],
              max_tokens: 10,
            }),
          });
          latencyMs = Date.now() - startTime;

          if (resp.ok) {
            const data = await resp.json();
            response = data.choices?.[0]?.message?.content?.trim() || '';
            success = response.includes(expectedAnswer);
            if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
          } else if (resp.status === 401) {
            error = 'Invalid API key';
          } else if (resp.status === 404) {
            error = `Model not found: ${apiModel}`;
          } else {
            const errBody = await resp.text();
            error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;
      }

      case 'google': {
        const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'gemini-1.5-flash') : 'gemini-1.5-flash';
        try {
          const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
          const resp = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: testPrompt }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          });
          latencyMs = Date.now() - startTime;

          if (resp.ok) {
            const data = await resp.json();
            response = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            success = response.includes(expectedAnswer);
            if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
          } else if (resp.status === 400 || resp.status === 403) {
            error = 'Invalid API key';
          } else if (resp.status === 404) {
            error = `Model not found: ${apiModel}`;
          } else {
            const errBody = await resp.text();
            error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;
      }

      case 'kimi': {
        const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'moonshot-v1-8k') : 'moonshot-v1-8k';
        try {
          const resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: apiModel,
              messages: [{ role: 'user', content: testPrompt }],
              max_tokens: 10,
            }),
          });
          latencyMs = Date.now() - startTime;

          if (resp.ok) {
            const data = await resp.json();
            response = data.choices?.[0]?.message?.content?.trim() || '';
            success = response.includes(expectedAnswer);
            if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
          } else if (resp.status === 401) {
            error = 'Invalid API key';
          } else if (resp.status === 404) {
            error = `Model not found: ${apiModel}`;
          } else {
            const errBody = await resp.text();
            error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;
      }

      case 'zai': {
        const apiModel = model ? (MODEL_API_IDS[model]?.apiModel || 'glm-4-flash') : 'glm-4-flash';
        try {
          const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: apiModel,
              messages: [{ role: 'user', content: testPrompt }],
              max_tokens: 10,
            }),
          });
          latencyMs = Date.now() - startTime;

          if (resp.ok) {
            const data = await resp.json();
            response = data.choices?.[0]?.message?.content?.trim() || '';
            success = response.includes(expectedAnswer);
            if (!success) error = `Model returned: ${response} (expected ${expectedAnswer})`;
          } else if (resp.status === 401) {
            error = 'Invalid API key';
          } else if (resp.status === 404) {
            error = `Model not found: ${apiModel}`;
          } else {
            const errBody = await resp.text();
            error = `HTTP ${resp.status}: ${errBody.slice(0, 100)}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;
      }

      default:
        error = `Unknown provider: ${provider}`;
    }

    res.json({ success, error, response, latencyMs, model: model || 'default' });
  } catch (error: any) {
    console.error('Error testing API key:', error);
    res.status(500).json({ error: 'Failed to test API key: ' + error.message });
  }
});

// Validate API key (PAN-118-23)
app.post('/api/settings/validate-api-key', async (req, res) => {
  try {
    const { provider, apiKey } = req.body;

    if (!provider || !apiKey) {
      res.status(400).json({ error: 'Provider and apiKey are required' });
      return;
    }

    let valid = false;
    let error: string | null = null;
    let models: string[] = [];

    // Validate based on provider
    switch (provider) {
      case 'openai':
        try {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            valid = true;
            // Extract relevant model IDs
            models = data.data
              .map((m: any) => m.id)
              .filter((id: string) =>
                id.includes('gpt-') || id.includes('o1') || id.includes('o3')
              );
          } else if (response.status === 401) {
            error = 'Invalid API key';
          } else if (response.status === 429) {
            error = 'Rate limit exceeded';
          } else {
            error = `HTTP error: ${response.status}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;

      case 'google':
        try {
          // Test with a minimal generateContent call
          const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
          const response = await fetch(testUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: 'test'
                }]
              }]
            }),
          });

          if (response.ok || response.status === 400) {
            // 400 is also OK - it means the key is valid but request was malformed (expected)
            valid = true;
            models = ['gemini-3-pro-preview', 'gemini-3-flash-preview'];
          } else if (response.status === 401 || response.status === 403) {
            error = 'Invalid API key';
          } else if (response.status === 429) {
            error = 'Rate limit exceeded';
          } else {
            error = `HTTP error: ${response.status}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;

      case 'zai':
        try {
          // Z.AI validation - assuming similar pattern to OpenAI
          const response = await fetch('https://api.zai.chat/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            valid = true;
            models = data.data?.map((m: any) => m.id) || ['glm-4.7', 'glm-4.7-flash'];
          } else if (response.status === 401) {
            error = 'Invalid API key';
          } else if (response.status === 429) {
            error = 'Rate limit exceeded';
          } else {
            error = `HTTP error: ${response.status}`;
          }
        } catch (err: any) {
          error = `Network error: ${err.message}`;
        }
        break;

      default:
        res.status(400).json({ error: `Unsupported provider: ${provider}` });
        return;
    }

    res.json({
      valid,
      provider,
      models: valid ? models : undefined,
      error: error || undefined,
    });
  } catch (error: any) {
    console.error('Error validating API key:', error);
    res.status(500).json({ error: 'Failed to validate API key: ' + error.message });
  }
});

// Update settings (PAN-78, updated for PAN-118)
app.put('/api/settings', (req, res) => {
  try {
    const newSettings = req.body;

    // Validate settings
    const validation = validateSettingsApi(newSettings);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors.join('; ') });
      return;
    }

    // Save settings to YAML
    saveSettingsApi(newSettings);

    // TODO: Regenerate router config for new work-type-based routing
    // const routerConfig = generateRouterConfig(newSettings);
    // writeRouterConfig(routerConfig);

    res.json({ success: true, message: 'Settings saved to config.yaml' });
  } catch (error: any) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings: ' + error.message });
  }
});

// Get Cloister configuration
app.get('/api/cloister/config', (_req, res) => {
  try {
    const config = loadCloisterConfig();
    res.json(config);
  } catch (error: any) {
    console.error('Error loading Cloister config:', error);
    res.status(500).json({ error: 'Failed to load Cloister config: ' + error.message });
  }
});

// Update Cloister configuration
app.put('/api/cloister/config', (req, res) => {
  try {
    const updates = req.body;
    const service = getCloisterService();

    // Save configuration
    saveCloisterConfig(updates);

    // Reload service configuration
    service.reloadConfig();

    res.json({ success: true, config: updates });
  } catch (error: any) {
    console.error('Error updating Cloister config:', error);
    res.status(500).json({ error: 'Failed to update Cloister config: ' + error.message });
  }
});

// ============================================================================
// Deacon API Endpoints (PAN-33 Phase 6 - Specialist Health Monitor)
// ============================================================================

// Get deacon status
app.get('/api/deacon/status', (_req, res) => {
  try {
    const service = getCloisterService();
    const status = service.getDeaconStatus();
    res.json(status);
  } catch (error: any) {
    console.error('Error getting deacon status:', error);
    res.status(500).json({ error: 'Failed to get deacon status: ' + error.message });
  }
});

// Run manual patrol
app.post('/api/deacon/patrol', async (_req, res) => {
  try {
    const service = getCloisterService();
    const result = await service.runDeaconPatrol();
    res.json(result);
  } catch (error: any) {
    console.error('Error running deacon patrol:', error);
    res.status(500).json({ error: 'Failed to run patrol: ' + error.message });
  }
});

// ============================================================================
// Metrics API Endpoints (PAN-33 Phase 6)
// ============================================================================

// Get metrics summary
app.get('/api/metrics/summary', (_req, res) => {
  try {
    const service = getCloisterService();
    const costSummary = service.getCostSummary();
    const status = service.getStatus();

    res.json({
      today: {
        totalCost: costSummary.dailyTotal,
        agentCount: status.summary.total,
        activeCount: status.summary.active,
        stuckCount: status.summary.stuck,
        warningCount: status.summary.warning,
      },
      topSpenders: {
        agents: costSummary.topAgents.slice(0, 5),
        issues: costSummary.topIssues.slice(0, 5),
      },
    });
  } catch (error: any) {
    console.error('Error getting metrics summary:', error);
    res.status(500).json({ error: 'Failed to get metrics summary: ' + error.message });
  }
});

// Get cost metrics (date range)
app.get('/api/metrics/costs', (_req, res) => {
  try {
    const service = getCloisterService();
    const costSummary = service.getCostSummary();

    res.json({
      dailyTotal: costSummary.dailyTotal,
      topAgents: costSummary.topAgents,
      topIssues: costSummary.topIssues,
    });
  } catch (error: any) {
    console.error('Error getting cost metrics:', error);
    res.status(500).json({ error: 'Failed to get cost metrics: ' + error.message });
  }
});

// Get handoff metrics
app.get('/api/metrics/handoffs', (_req, res) => {
  try {
    // Placeholder - would need handoff stats from handoff-logger
    res.json({
      totalHandoffs: 0,
      successRate: 0,
      byType: {},
    });
  } catch (error: any) {
    console.error('Error getting handoff metrics:', error);
    res.status(500).json({ error: 'Failed to get handoff metrics: ' + error.message });
  }
});

// Get stuck agent incidents
app.get('/api/metrics/stuck', (_req, res) => {
  try {
    const service = getCloisterService();
    const status = service.getStatus();

    res.json({
      current: status.summary.stuck,
      incidents: [], // Placeholder - would need historical tracking
    });
  } catch (error: any) {
    console.error('Error getting stuck agent metrics:', error);
    res.status(500).json({ error: 'Failed to get stuck agent metrics: ' + error.message });
  }
});

// ============================================================================
// Confirmation Dialog System (PAN-33)
// ============================================================================

/**
 * In-memory store for pending confirmation requests.
 * In the future, this could be enhanced with tmux output polling to automatically
 * detect confirmation prompts from agents.
 */
interface ConfirmationRequest {
  id: string;
  agentId: string;
  sessionName: string;
  action: string;
  details?: string;
  timestamp: string;
}

const pendingConfirmations = new Map<string, ConfirmationRequest>();

// Get pending confirmation requests
app.get('/api/confirmations', (_req, res) => {
  res.json(Array.from(pendingConfirmations.values()));
});

// Respond to a confirmation request
app.post('/api/confirmations/:id/respond', async (req, res) => {
  const { id } = req.params;
  const { confirmed } = req.body;

  const request = pendingConfirmations.get(id);
  if (!request) {
    return res.status(404).json({ error: 'Confirmation request not found' });
  }

  try {
    // Send response to the agent's tmux session using centralized sendKeys
    const response = confirmed ? 'y' : 'n';
    sendKeys(request.sessionName, response);

    // Remove from pending
    pendingConfirmations.delete(id);

    res.json({ success: true, confirmed });
  } catch (error: any) {
    console.error('Error sending confirmation response:', error);
    res.status(500).json({ error: 'Failed to send response: ' + error.message });
  }
});

// ============================================================================
// Specialist Agent Endpoints (PAN-27)
// ============================================================================

// Get all specialists with status
// Returns both legacy global specialists and new per-project specialists
app.get('/api/specialists', async (_req, res) => {
  try {
    const {
      getAllSpecialistStatus,
      getAllProjectSpecialistStatuses
    } = await import('../../lib/cloister/specialists.js');

    // Get legacy global specialists
    const legacySpecialists = await getAllSpecialistStatus();

    // Get per-project specialists
    const projectSpecialists = await getAllProjectSpecialistStatuses();

    res.json({
      // Legacy format (for backward compatibility)
      specialists: legacySpecialists,
      // New per-project format
      projects: projectSpecialists,
    });
  } catch (error: any) {
    console.error('Error getting specialists:', error);
    res.status(500).json({ error: 'Failed to get specialists: ' + error.message });
  }
});

// Wake a specialist agent
app.post('/api/specialists/:name/wake', async (req, res) => {
  const { name } = req.params;
  const { sessionId } = req.body;

  try {
    const {
      getTmuxSessionName,
      getSessionId,
      recordWake,
      isRunning
    } = await import('../../lib/cloister/specialists.js');

    // Check if already running
    if (await isRunning(name as any)) {
      return res.status(400).json({ error: `Specialist ${name} is already running` });
    }

    const existingSessionId = getSessionId(name as any);
    const tmuxSession = getTmuxSessionName(name as any);

    if (!existingSessionId && !sessionId) {
      return res.status(400).json({
        error: 'No session ID found. Specialist must be initialized first or provide sessionId in request.'
      });
    }

    const useSessionId = sessionId || existingSessionId;

    // Get specialist model from settings
    const specSettings = loadSettings();
    const specModelKey = `${name}_agent` as keyof typeof specSettings.models.specialists;
    const specModel = specSettings.models.specialists[specModelKey] || 'claude-sonnet-4-5';
    const specCmd = getAgentCommand(specModel);
    const specCmdWithArgs = specCmd.args.length > 0
      ? `${specCmd.command} ${specCmd.args.join(' ')} --dangerously-skip-permissions`
      : `${specCmd.command} --dangerously-skip-permissions`;

    // Spawn Claude with resume flag in tmux
    const cwd = homedir();
    await execAsync(
      `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "${specCmdWithArgs} --resume ${useSessionId}"`,
      { encoding: 'utf-8' }
    );

    // Record wake event
    recordWake(name as any, useSessionId);

    res.json({
      success: true,
      message: `Specialist ${name} woken up`,
      tmuxSession,
      sessionId: useSessionId,
    });
  } catch (error: any) {
    console.error('Error waking specialist:', error);
    res.status(500).json({ error: 'Failed to wake specialist: ' + error.message });
  }
});

// Reset all specialist agents (kills running ones first)
// NOTE: Must come BEFORE :name/reset to avoid matching "reset-all" as a name
app.post('/api/specialists/reset-all', async (_req, res) => {
  try {
    const {
      getAllSpecialists,
      clearSessionId,
      isRunning,
      getTmuxSessionName
    } = await import('../../lib/cloister/specialists.js');
    const { clearHook } = await import('../../lib/hooks.js');

    const specialists = getAllSpecialists();
    const results: { name: string; killed: boolean; sessionCleared: boolean; queueCleared: boolean }[] = [];

    for (const specialist of specialists) {
      const name = specialist.name;
      let killed = false;

      // Kill if running
      if (isRunning(name)) {
        const tmuxSession = getTmuxSessionName(name);
        try {
          await execAsync(`tmux kill-session -t "${tmuxSession}"`);
          killed = true;
        } catch {
          // Session might not exist, continue
        }
      }

      // Clear session file
      const sessionCleared = clearSessionId(name);

      // Clear queue
      clearHook(name);

      results.push({ name, killed, sessionCleared, queueCleared: true });
    }

    // Reset any "reviewing" statuses to "pending"
    let reviewStatusesReset = 0;
    try {
      const statuses = loadReviewStatuses();
      for (const key of Object.keys(statuses)) {
        if (statuses[key].reviewStatus === 'reviewing') {
          statuses[key].reviewStatus = 'pending';
          statuses[key].updatedAt = new Date().toISOString();
          reviewStatusesReset++;
        }
      }
      if (reviewStatusesReset > 0) {
        saveReviewStatuses(statuses);
      }
    } catch (e) {
      console.error('Failed to reset review statuses:', e);
    }

    res.json({
      success: true,
      message: `Reset ${results.length} specialists, cleared queues, reset ${reviewStatusesReset} review statuses`,
      results,
      reviewStatusesReset,
    });
  } catch (error: any) {
    console.error('Error resetting all specialists:', error);
    res.status(500).json({ error: 'Failed to reset specialists: ' + error.message });
  }
});

// Reset a specialist agent (clear session)
app.post('/api/specialists/:name/reset', async (req, res) => {
  const { name } = req.params;
  const { reinitialize = false } = req.body;

  try {
    const {
      clearSessionId,
      isRunning,
      getTmuxSessionName
    } = await import('../../lib/cloister/specialists.js');

    // Check if running - must be stopped first
    if (await isRunning(name as any)) {
      const tmuxSession = getTmuxSessionName(name as any);
      return res.status(400).json({
        error: `Specialist ${name} is currently running. Stop it first (tmux kill-session -t ${tmuxSession})`
      });
    }

    // Clear session file
    const wasDeleted = clearSessionId(name as any);

    if (reinitialize) {
      // TODO: Add initialization logic if needed
      // For now, just clearing is sufficient
    }

    res.json({
      success: true,
      message: `Specialist ${name} reset`,
      sessionCleared: wasDeleted,
    });
  } catch (error: any) {
    console.error('Error resetting specialist:', error);
    res.status(500).json({ error: 'Failed to reset specialist: ' + error.message });
  }
});

// Initialize a specialist agent (first-time setup)
app.post('/api/specialists/:name/init', async (req, res) => {
  const { name } = req.params;

  try {
    const { initializeSpecialist } = await import('../../lib/cloister/specialists.js');

    const result = await initializeSpecialist(name as any);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      success: true,
      message: result.message,
      tmuxSession: result.tmuxSession,
      note: 'Session ID will be available after Claude responds. Use "claude config get sessionId" in the tmux session to get it, then update via /reset with reinitialize.'
    });
  } catch (error: any) {
    console.error('Error initializing specialist:', error);
    res.status(500).json({ error: 'Failed to initialize specialist: ' + error.message });
  }
});

// Specialist reports status (PAN-80 - replaces terminal parsing)
app.post('/api/specialists/:name/report-status', async (req, res) => {
  const { name } = req.params;
  const { issueId, status, notes } = req.body;

  if (!issueId || !status) {
    return res.status(400).json({ error: 'issueId and status required' });
  }

  if (!['passed', 'blocked', 'failed', 'in-progress'].includes(status)) {
    return res.status(400).json({ error: 'status must be: passed, blocked, failed, or in-progress' });
  }

  try {
    // Write status to specialist's state directory
    const specialistDir = join(homedir(), '.panopticon', 'specialists', name);
    mkdirSync(specialistDir, { recursive: true });

    const statusFile = join(specialistDir, `${issueId}-status.json`);
    const statusData = {
      issueId,
      specialist: name,
      status,
      notes: notes || '',
      timestamp: new Date().toISOString(),
    };

    writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

    console.log(`[specialists] ${name} reported status for ${issueId}: ${status}`);

    // When specialist reports completion (passed/blocked/failed), set state to idle
    if (['passed', 'blocked', 'failed'].includes(status)) {
      const { getTmuxSessionName } = await import('../../lib/cloister/specialists.js');
      const tmuxSession = getTmuxSessionName(name as any);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error saving specialist status:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to save status: ' + message });
  }
});

// Get specialist cost
app.get('/api/specialists/:name/cost', async (req, res) => {
  const { name } = req.params;

  try {
    const { getSessionId } = await import('../../lib/cloister/specialists.js');
    const sessionId = getSessionId(name as any);

    if (!sessionId) {
      return res.json({ cost: 0, inputTokens: 0, outputTokens: 0 });
    }

    // Find the JSONL session file
    const homeDir = process.env.HOME || '/home/eltmon';
    const claudeProjectsDir = join(homeDir, '.claude', 'projects');

    // Specialists run from home directory, so the project dir is just the home dir
    const projectDirName = `-${homeDir.replace(/^\//, '').replace(/\//g, '-')}`;
    const projectDir = join(claudeProjectsDir, projectDirName);
    const sessionsIndexPath = join(projectDir, 'sessions-index.json');

    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = '';

    if (existsSync(sessionsIndexPath)) {
      const indexContent = JSON.parse(readFileSync(sessionsIndexPath, 'utf-8'));
      const sessionEntry = indexContent.entries?.find((e: any) => e.sessionId === sessionId);

      if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
        const jsonlContent = readFileSync(sessionEntry.fullPath, 'utf-8');
        const lines = jsonlContent.split('\n').filter((l: string) => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            // Extract usage from message.usage or top-level usage
            const usage = entry.message?.usage || entry.usage;
            const model = entry.message?.model || entry.model;

            if (usage) {
              inputTokens += usage.input_tokens || 0;
              outputTokens += usage.output_tokens || 0;
              cacheReadTokens += usage.cache_read_input_tokens || 0;
              cacheWriteTokens += usage.cache_creation_input_tokens || 0;
            }
            // Track the model being used
            if (model && !detectedModel) {
              detectedModel = model;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    // Calculate cost from usage using pricing data
    if (inputTokens > 0 || outputTokens > 0) {
      const modelInfo = normalizeModelName(detectedModel || 'claude-sonnet-4');
      const pricing = getPricing(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCost(usage, pricing);
      }
    }

    res.json({ cost, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model: detectedModel });
  } catch (error: any) {
    console.error('Error getting specialist cost:', error);
    res.json({ cost: 0, inputTokens: 0, outputTokens: 0 });
  }
});

// ============================================================================
// Specialist Queue Management (PAN-74)
// ============================================================================

// Get all specialist queues with counts and items
app.get('/api/specialists/queues', async (_req, res) => {
  try {
    const { getAllSpecialists, checkSpecialistQueue } = await import('../../lib/cloister/specialists.js');
    const specialists = getAllSpecialists();

    const queues = await Promise.all(
      specialists.map(async (specialist) => {
        const queue = checkSpecialistQueue(specialist.name);
        return {
          specialistName: specialist.name,
          hasWork: queue.hasWork,
          urgentCount: queue.urgentCount,
          totalCount: queue.items.length,
          items: queue.items,
        };
      })
    );

    res.json({ queues });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error getting specialist queues:', error);
    res.status(500).json({ error: 'Failed to get specialist queues: ' + msg });
  }
});

// Get specific specialist's queue
app.get('/api/specialists/:name/queue', async (req, res) => {
  const { name } = req.params;

  try {
    const { checkSpecialistQueue } = await import('../../lib/cloister/specialists.js');
    type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent';

    // Validate specialist name
    const validNames: string[] = ['merge-agent', 'review-agent', 'test-agent'];
    if (!validNames.includes(name)) {
      return res.status(400).json({ error: `Invalid specialist name: ${name}` });
    }

    const queue = checkSpecialistQueue(name as SpecialistType);

    res.json({
      specialistName: name,
      hasWork: queue.hasWork,
      urgentCount: queue.urgentCount,
      totalCount: queue.items.length,
      items: queue.items,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error getting queue for ${name}:`, error);
    res.status(500).json({ error: `Failed to get queue for ${name}: ${msg}` });
  }
});

// Queue work to a specialist (uses wakeSpecialistOrQueue - handles busy specialists)
app.post('/api/specialists/:name/queue', async (req, res) => {
  const { name } = req.params;
  const { issueId, workspace, branch, customPrompt, priority = 'normal' } = req.body;

  try {
    const { wakeSpecialistOrQueue } = await import('../../lib/cloister/specialists.js');
    type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent';

    // Validate specialist name
    const validNames: string[] = ['merge-agent', 'review-agent', 'test-agent'];
    if (!validNames.includes(name)) {
      return res.status(400).json({ error: `Invalid specialist name: ${name}` });
    }

    if (!issueId) {
      return res.status(400).json({ error: 'issueId is required' });
    }

    const result = await wakeSpecialistOrQueue(
      name as SpecialistType,
      {
        issueId,
        workspace,
        branch,
        customPrompt,
      },
      {
        priority: priority as 'urgent' | 'normal' | 'low',
        source: 'api-queue',
      }
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error queuing work to ${name}:`, error);
    res.status(500).json({ error: `Failed to queue work to ${name}: ${msg}` });
  }
});

// Remove item from specialist's queue
app.delete('/api/specialists/:name/queue/:itemId', async (req, res) => {
  const { name, itemId } = req.params;

  try {
    const { completeSpecialistTask } = await import('../../lib/cloister/specialists.js');
    type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent';

    // Validate specialist name
    const validNames: string[] = ['merge-agent', 'review-agent', 'test-agent'];
    if (!validNames.includes(name)) {
      return res.status(400).json({ error: `Invalid specialist name: ${name}` });
    }

    const success = completeSpecialistTask(name as SpecialistType, itemId);

    if (!success) {
      return res.status(404).json({ error: `Item ${itemId} not found in queue for ${name}` });
    }

    res.json({
      success: true,
      message: `Removed item ${itemId} from ${name}'s queue`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error removing item from ${name}'s queue:`, error);
    res.status(500).json({ error: `Failed to remove item: ${msg}` });
  }
});

// Reorder specialist's queue
app.put('/api/specialists/:name/queue/reorder', async (req, res) => {
  const { name } = req.params;
  const { itemIds } = req.body;

  if (!Array.isArray(itemIds)) {
    return res.status(400).json({ error: 'itemIds must be an array' });
  }

  try {
    const { reorderHookItems } = await import('../../lib/hooks.js');

    // Validate specialist name
    const validNames: string[] = ['merge-agent', 'review-agent', 'test-agent'];
    if (!validNames.includes(name)) {
      return res.status(400).json({ error: `Invalid specialist name: ${name}` });
    }

    const success = reorderHookItems(name, itemIds);

    if (!success) {
      return res.status(400).json({ error: 'Failed to reorder queue. Check that all item IDs are valid.' });
    }

    res.json({
      success: true,
      message: `Reordered queue for ${name}`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error reordering queue for ${name}:`, error);
    res.status(500).json({ error: `Failed to reorder queue: ${msg}` });
  }
});

// Auto-complete: Hook-triggered specialist completion detection
// Called by specialist-stop-hook when it detects completion patterns in terminal output
app.post('/api/specialists/:name/auto-complete', async (req, res) => {
  const { name } = req.params;
  const { issueId, status } = req.body;

  if (!issueId || !status) {
    return res.status(400).json({ error: 'issueId and status required' });
  }

  console.log(`[specialists] Auto-detected completion for ${name}: ${issueId} -> ${status}`);

  try {
    const {
      getTmuxSessionName,
      completeSpecialistTask,
      getNextSpecialistTask,
      wakeSpecialistWithTask,
      checkSpecialistQueue,
      submitToSpecialistQueue,
    } = await import('../../lib/cloister/specialists.js');

    type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent';

    // Validate specialist name
    const validNames: string[] = ['merge-agent', 'review-agent', 'test-agent'];
    if (!validNames.includes(name)) {
      return res.status(400).json({ error: `Invalid specialist name: ${name}` });
    }

    const tmuxSession = getTmuxSessionName(name as SpecialistType);

    // Set specialist to idle and clear currentIssue
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
      currentIssue: undefined,
    });

    // Update review/test status based on specialist type
    if (name === 'review-agent') {
      setReviewStatus(issueId, {
        reviewStatus: status === 'passed' ? 'passed' : 'blocked',
        reviewNotes: `Auto-detected: ${status}`,
      });

      // If passed, queue test-agent
      if (status === 'passed') {
        // Get workspace info from work agent state
        const workAgentId = `agent-${issueId.toLowerCase()}`;
        const workStateFile = join(homedir(), '.panopticon', 'agents', workAgentId, 'state.json');
        let workspace: string | undefined;
        let branch: string | undefined;

        if (existsSync(workStateFile)) {
          try {
            const workState = JSON.parse(readFileSync(workStateFile, 'utf-8'));
            workspace = workState.workspace;
            branch = workState.branch || `feature/${issueId.toLowerCase()}`;
          } catch {}
        }

        submitToSpecialistQueue('test-agent', {
          priority: 'high',
          source: 'review-agent-auto',
          issueId,
          workspace,
          branch,
        });
        console.log(`[specialists] Queued test-agent for ${issueId} after review passed`);
      }
    } else if (name === 'test-agent') {
      setReviewStatus(issueId, {
        testStatus: status === 'passed' ? 'passed' : 'failed',
        testNotes: `Auto-detected: ${status}`,
      });
    }

    // Clear the current task from queue (if it matches)
    const queueStatus = checkSpecialistQueue(name as SpecialistType);
    for (const item of queueStatus.items) {
      if (item.payload?.issueId?.toUpperCase() === issueId.toUpperCase()) {
        completeSpecialistTask(name as SpecialistType, item.id);
        console.log(`[specialists] Cleared ${issueId} from ${name} queue`);
        break;
      }
    }

    // Check for next queued task and wake if available
    // Validate items before waking - skip stale items
    const specialistQueue = checkSpecialistQueue(name as SpecialistType);
    let nextValidTask = null;
    for (const task of specialistQueue.items) {
      const taskIssueId = task.payload?.issueId;
      if (!taskIssueId) {
        completeSpecialistTask(name as SpecialistType, task.id);
        continue;
      }

      const taskStatus = getReviewStatus(taskIssueId);
      // Skip already-completed items based on specialist type
      if (name === 'review-agent' && taskStatus?.reviewStatus === 'passed') {
        completeSpecialistTask(name as SpecialistType, task.id);
        console.log(`[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already reviewed)`);
        continue;
      }
      if (name === 'test-agent' && taskStatus?.testStatus === 'passed') {
        completeSpecialistTask(name as SpecialistType, task.id);
        console.log(`[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already tested)`);
        continue;
      }
      if (taskStatus?.mergeStatus === 'merged') {
        completeSpecialistTask(name as SpecialistType, task.id);
        console.log(`[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already merged)`);
        continue;
      }

      nextValidTask = task;
      break;
    }

    if (nextValidTask) {
      console.log(`[specialists] Waking ${name} for next task: ${nextValidTask.payload.issueId}`);
      await wakeSpecialistWithTask(name as SpecialistType, {
        issueId: nextValidTask.payload.issueId!,
        workspace: nextValidTask.payload.context?.workspace,
        branch: nextValidTask.payload.context?.branch,
      });
      completeSpecialistTask(name as SpecialistType, nextValidTask.id);
    }

    res.json({
      success: true,
      status,
      issueId,
      nextTaskQueued: !!nextValidTask,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error processing auto-complete for ${name}:`, error);
    res.status(500).json({ error: msg });
  }
});

// Get agent health (Cloister-based)
app.get('/api/agents/:id/cloister-health', (req, res) => {
  try {
    const { id } = req.params;
    const service = getCloisterService();
    const health = service.getAgentHealth(id);

    if (!health) {
      return res.status(404).json({ error: 'Agent not found or runtime not available' });
    }

    res.json(health);
  } catch (error: any) {
    console.error('Error getting agent health:', error);
    res.status(500).json({ error: 'Failed to get agent health: ' + error.message });
  }
});

// Get all agents health
app.get('/api/cloister/agents/health', (_req, res) => {
  try {
    const service = getCloisterService();
    const agentHealths = service.getAllAgentHealth();
    res.json({ agents: agentHealths });
  } catch (error: any) {
    console.error('Error getting agents health:', error);
    res.status(500).json({ error: 'Failed to get agents health: ' + error.message });
  }
});

// Get activity log
app.get('/api/activity', (_req, res) => {
  res.json(activities);
});

// Get specific activity
app.get('/api/activity/:id', (req, res) => {
  const activity = activities.find(a => a.id === req.params.id);
  if (!activity) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  res.json(activity);
});

// ============================================================================
// Per-Project Specialist API Endpoints (PAN-79)
// ============================================================================

/**
 * Validate and return specialist type
 */
function validateSpecialistType(type: string): type is 'review-agent' | 'test-agent' | 'merge-agent' {
  return type === 'review-agent' || type === 'test-agent' || type === 'merge-agent';
}

// Get all per-project specialist statuses
app.get('/api/specialists/projects', async (_req, res) => {
  try {
    const { getAllProjectSpecialistStatuses } = await import('../../lib/cloister/specialists.js');
    const specialists = await getAllProjectSpecialistStatuses();
    res.json(specialists);
  } catch (error: unknown) {
    console.error('Error getting project specialists:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get project specialists: ' + message });
  }
});

// Spawn ephemeral specialist for a project
app.post('/api/specialists/:project/:type/spawn', async (req, res) => {
  const { project, type } = req.params;
  const { issueId, branch, workspace, prUrl, context } = req.body;

  if (!issueId) {
    return res.status(400).json({ error: 'issueId is required' });
  }

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { spawnEphemeralSpecialist } = await import('../../lib/cloister/specialists.js');

    const result = await spawnEphemeralSpecialist(
      project,
      type,
      { issueId, branch, workspace, prUrl, context }
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (error: unknown) {
    console.error('Error spawning specialist:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to spawn specialist: ' + message });
  }
});

// Get run logs for a project's specialist
app.get('/api/specialists/:project/:type/runs', async (req, res) => {
  const { project, type } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

  try {
    const { listRunLogs } = await import('../../lib/cloister/specialist-logs.js');
    const runs = listRunLogs(project, type, { limit, offset });
    res.json(runs);
  } catch (error: unknown) {
    console.error('Error listing run logs:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to list run logs: ' + message });
  }
});

// Get a specific run log
app.get('/api/specialists/:project/:type/runs/:runId', async (req, res) => {
  const { project, type, runId } = req.params;

  try {
    const { getRunLog, parseLogMetadata } = await import('../../lib/cloister/specialist-logs.js');
    const content = getRunLog(project, type, runId);

    if (!content) {
      return res.status(404).json({ error: 'Run log not found' });
    }

    const metadata = parseLogMetadata(content);
    res.json({
      runId,
      content,
      metadata,
    });
  } catch (error: unknown) {
    console.error('Error getting run log:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get run log: ' + message });
  }
});

// Stream run log in real-time (SSE)
app.get('/api/specialists/:project/:type/runs/:runId/stream', async (req, res) => {
  const { project, type, runId } = req.params;

  try {
    const {
      getRunLogPath,
      isRunLogActive,
    } = await import('../../lib/cloister/specialist-logs.js');

    const logPath = getRunLogPath(project, type, runId);

    if (!existsSync(logPath)) {
      return res.status(404).json({ error: 'Run log not found' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Read existing content
    let lastSize = 0;
    const content = readFileSync(logPath, 'utf-8');
    res.write(`data: ${JSON.stringify({ type: 'content', data: content })}\n\n`);
    lastSize = content.length;

    // Poll for updates if log is still active
    const checkForUpdates = async () => {
      if (!isRunLogActive(project, type, runId)) {
        // Log completed, send final update and close
        const finalContent = readFileSync(logPath, 'utf-8');
        if (finalContent.length > lastSize) {
          const newContent = finalContent.substring(lastSize);
          res.write(`data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
        res.end();
        return;
      }

      // Check for new content
      try {
        const currentContent = readFileSync(logPath, 'utf-8');
        if (currentContent.length > lastSize) {
          const newContent = currentContent.substring(lastSize);
          res.write(`data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`);
          lastSize = currentContent.length;
        }
      } catch (error) {
        console.error('Error reading log file:', error);
      }

      // Continue polling
      setTimeout(checkForUpdates, 1000);
    };

    // Start polling after initial send
    setTimeout(checkForUpdates, 1000);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`[SSE] Client disconnected from ${project}/${type}/${runId}`);
    });
  } catch (error: unknown) {
    console.error('Error streaming run log:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to stream run log: ' + message });
  }
});

// Terminate a specific run
app.post('/api/specialists/:project/:type/runs/:runId/terminate', async (req, res) => {
  const { project, type } = req.params;

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { terminateSpecialist } = await import('../../lib/cloister/specialists.js');
    await terminateSpecialist(project, type);
    res.json({ success: true, message: 'Specialist terminated' });
  } catch (error: unknown) {
    console.error('Error terminating specialist:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to terminate specialist: ' + message });
  }
});

// Pause grace period
app.post('/api/specialists/:project/:type/grace/pause', async (req, res) => {
  const { project, type } = req.params;

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { pauseGracePeriod } = await import('../../lib/cloister/specialists.js');
    const success = pauseGracePeriod(project, type);

    if (success) {
      res.json({ success: true, message: 'Grace period paused' });
    } else {
      res.status(400).json({ error: 'No active grace period to pause' });
    }
  } catch (error: unknown) {
    console.error('Error pausing grace period:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to pause grace period: ' + message });
  }
});

// Resume grace period
app.post('/api/specialists/:project/:type/grace/resume', async (req, res) => {
  const { project, type } = req.params;

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { resumeGracePeriod } = await import('../../lib/cloister/specialists.js');
    const success = resumeGracePeriod(project, type);

    if (success) {
      res.json({ success: true, message: 'Grace period resumed' });
    } else {
      res.status(400).json({ error: 'No paused grace period to resume' });
    }
  } catch (error: unknown) {
    console.error('Error resuming grace period:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to resume grace period: ' + message });
  }
});

// Exit grace period immediately
app.post('/api/specialists/:project/:type/grace/exit', async (req, res) => {
  const { project, type } = req.params;

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { exitGracePeriod } = await import('../../lib/cloister/specialists.js');
    exitGracePeriod(project, type);
    res.json({ success: true, message: 'Specialist terminated immediately' });
  } catch (error: unknown) {
    console.error('Error exiting grace period:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to exit grace period: ' + message });
  }
});

// Get grace period state
app.get('/api/specialists/:project/:type/grace', async (req, res) => {
  const { project, type } = req.params;

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { getGracePeriodState } = await import('../../lib/cloister/specialists.js');
    const state = getGracePeriodState(project, type);

    if (state) {
      res.json(state);
    } else {
      res.status(404).json({ error: 'No active grace period' });
    }
  } catch (error: unknown) {
    console.error('Error getting grace period state:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get grace period state: ' + message });
  }
});

// Get context digest for a project's specialist
app.get('/api/specialists/:project/:type/context', async (req, res) => {
  const { project, type } = req.params;

  try {
    const { loadContextDigest } = await import('../../lib/cloister/specialist-context.js');
    const digest = loadContextDigest(project, type);

    if (digest) {
      res.json({ digest });
    } else {
      res.status(404).json({ error: 'No context digest found' });
    }
  } catch (error: unknown) {
    console.error('Error getting context digest:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get context digest: ' + message });
  }
});

// Regenerate context digest
app.post('/api/specialists/:project/:type/context/regenerate', async (req, res) => {
  const { project, type } = req.params;

  try {
    const { regenerateContextDigest } = await import('../../lib/cloister/specialist-context.js');
    const digest = await regenerateContextDigest(project, type);

    if (digest) {
      res.json({ digest, message: 'Context digest regenerated' });
    } else {
      res.status(500).json({ error: 'Failed to generate context digest' });
    }
  } catch (error: unknown) {
    console.error('Error regenerating context digest:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to regenerate context digest: ' + message });
  }
});

// Signal specialist completion (for specialists to call)
app.post('/api/specialists/:project/:type/complete', async (req, res) => {
  const { project, type } = req.params;
  const { status, notes } = req.body;

  if (!status || !['passed', 'failed', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'Valid status (passed/failed/blocked) is required' });
  }

  if (!validateSpecialistType(type)) {
    return res.status(400).json({ error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' });
  }

  try {
    const { signalSpecialistCompletion } = await import('../../lib/cloister/specialists.js');
    signalSpecialistCompletion(project, type, { status, notes });
    res.json({ success: true, message: 'Specialist completion signaled, grace period started' });
  } catch (error: unknown) {
    console.error('Error signaling completion:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to signal completion: ' + message });
  }
});

// Clean up old logs for a specific project/specialist
app.post('/api/specialists/:project/:type/logs/cleanup', async (req, res) => {
  const { project, type } = req.params;

  try {
    const { cleanupOldLogs } = await import('../../lib/cloister/specialist-logs.js');
    const { getSpecialistRetention } = await import('../../lib/projects.js');

    const retention = getSpecialistRetention(project);
    const deleted = cleanupOldLogs(project, type, retention);

    res.json({
      success: true,
      deleted,
      message: `Cleaned up ${deleted} old logs`,
    });
  } catch (error: unknown) {
    console.error('Error cleaning up logs:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to clean up logs: ' + message });
  }
});

// Clean up old logs for all projects and specialists
app.post('/api/specialists/logs/cleanup-all', async (_req, res) => {
  try {
    const { cleanupAllLogs } = await import('../../lib/cloister/specialist-logs.js');
    const results = cleanupAllLogs();

    res.json({
      success: true,
      totalDeleted: results.totalDeleted,
      byProject: results.byProject,
      message: `Cleaned up ${results.totalDeleted} old logs`,
    });
  } catch (error: unknown) {
    console.error('Error cleaning up all logs:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to clean up logs: ' + message });
  }
});

// ============================================================================
// Convoy API Endpoints
// ============================================================================

// List all convoys
app.get('/api/convoys', (_req, res) => {
  try {
    const convoys = listConvoys();
    res.json({ convoys });
  } catch (error: any) {
    console.error('Error listing convoys:', error);
    res.status(500).json({ error: 'Failed to list convoys: ' + error.message });
  }
});

// Get convoy status
app.get('/api/convoys/:id', (req, res) => {
  try {
    const convoy = getConvoyStatus(req.params.id);
    if (!convoy) {
      return res.status(404).json({ error: 'Convoy not found' });
    }
    res.json(convoy);
  } catch (error: any) {
    console.error('Error getting convoy status:', error);
    res.status(500).json({ error: 'Failed to get convoy status: ' + error.message });
  }
});

// Start a new convoy
app.post('/api/convoys/start', async (req, res) => {
  try {
    const { template, context } = req.body;

    if (!template) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    if (!context || !context.projectPath) {
      return res.status(400).json({ error: 'Context with projectPath is required' });
    }

    const convoy = await startConvoy(template, context as ConvoyContext);
    res.json(convoy);
  } catch (error: any) {
    console.error('Error starting convoy:', error);
    res.status(500).json({ error: 'Failed to start convoy: ' + error.message });
  }
});

// Stop a convoy
app.post('/api/convoys/:id/stop', async (req, res) => {
  try {
    await stopConvoy(req.params.id);
    res.json({ success: true, message: 'Convoy stopped' });
  } catch (error: any) {
    console.error('Error stopping convoy:', error);
    res.status(500).json({ error: 'Failed to stop convoy: ' + error.message });
  }
});

// Get convoy output (combined from all agents)
app.get('/api/convoys/:id/output', (req, res) => {
  try {
    const convoy = getConvoyStatus(req.params.id);
    if (!convoy) {
      return res.status(404).json({ error: 'Convoy not found' });
    }

    const outputs: Record<string, string> = {};

    for (const agent of convoy.agents) {
      if (agent.outputFile && existsSync(agent.outputFile)) {
        try {
          outputs[agent.role] = readFileSync(agent.outputFile, 'utf-8');
        } catch (err) {
          outputs[agent.role] = `Error reading output: ${err}`;
        }
      }
    }

    res.json({ outputs });
  } catch (error: any) {
    console.error('Error getting convoy output:', error);
    res.status(500).json({ error: 'Failed to get convoy output: ' + error.message });
  }
});

// ============================================================================
// Handoff API Endpoints (Phase 4)
// ============================================================================

// Get handoff suggestion for an agent
app.get('/api/agents/:id/handoff/suggestion', async (req, res) => {
  try {
    const agentId = req.params.id;
    const agentState = getAgentState(agentId);

    if (!agentState) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get agent health
    const runtime = getRuntimeForAgent(agentId);
    if (!runtime) {
      return res.status(404).json({ error: 'Runtime not found for agent' });
    }

    const health = getAgentHealth(agentId, runtime);

    // Check all triggers
    const triggers = await checkAllTriggers(
      agentId,
      agentState.workspace,
      agentState.issueId,
      agentState.model,
      health,
      loadCloisterConfig()
    );

    if (triggers.length > 0) {
      const trigger = triggers[0];
      return res.json({
        suggested: true,
        trigger: trigger.type,
        currentModel: agentState.model,
        suggestedModel: trigger.suggestedModel,
        reason: trigger.reason,
      });
    }

    res.json({
      suggested: false,
      trigger: null,
      currentModel: agentState.model,
      suggestedModel: null,
      reason: 'No handoff triggers detected',
    });
  } catch (error: any) {
    console.error('Error getting handoff suggestion:', error);
    res.status(500).json({ error: 'Failed to get handoff suggestion: ' + error.message });
  }
});

// Execute handoff for an agent
app.post('/api/agents/:id/handoff', async (req, res) => {
  try {
    const agentId = req.params.id;
    const { toModel, reason } = req.body;

    if (!toModel) {
      return res.status(400).json({ error: 'toModel is required' });
    }

    const result = await performHandoff(agentId, {
      targetModel: toModel,
      reason: reason || 'Manual handoff from dashboard',
    });

    if (result.success) {
      res.json({
        success: true,
        newAgentId: result.newAgentId,
        newSessionId: result.newSessionId,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    console.error('Error executing handoff:', error);
    res.status(500).json({ error: 'Failed to execute handoff: ' + error.message });
  }
});

// Get handoff history for an issue
app.get('/api/issues/:id/handoffs', (req, res) => {
  try {
    const issueId = req.params.id;
    const handoffs = readIssueHandoffEvents(issueId);
    res.json({ handoffs });
  } catch (error: any) {
    console.error('Error getting issue handoffs:', error);
    res.status(500).json({ error: 'Failed to get issue handoffs: ' + error.message });
  }
});

// Get handoff history for an agent
app.get('/api/agents/:id/handoffs', (req, res) => {
  try {
    const agentId = req.params.id;
    const handoffs = readAgentHandoffEvents(agentId);
    res.json({ handoffs });
  } catch (error: any) {
    console.error('Error getting agent handoffs:', error);
    res.status(500).json({ error: 'Failed to get agent handoffs: ' + error.message });
  }
});

// Get all handoff events
app.get('/api/handoffs', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const handoffs = readHandoffEvents(limit);
    res.json({
      handoffs,
      total: handoffs.length,
    });
  } catch (error: any) {
    console.error('Error getting handoffs:', error);
    res.status(500).json({ error: 'Failed to get handoffs: ' + error.message });
  }
});

// Get handoff statistics
app.get('/api/handoffs/stats', (req, res) => {
  try {
    const stats = getHandoffStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Error getting handoff stats:', error);
    res.status(500).json({ error: 'Failed to get handoff stats: ' + error.message });
  }
});

// Get all specialist handoff events
app.get('/api/specialist-handoffs', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const handoffs = readSpecialistHandoffs(limit);
    res.json({
      handoffs,
      total: handoffs.length,
    });
  } catch (error: any) {
    console.error('Error getting specialist handoffs:', error);
    res.status(500).json({ error: 'Failed to get specialist handoffs: ' + error.message });
  }
});

// Get specialist handoff statistics
app.get('/api/specialist-handoffs/stats', (req, res) => {
  try {
    const stats = getSpecialistHandoffStats();
    res.json(stats);
  } catch (error: any) {
    console.error('Error getting specialist handoff stats:', error);
    res.status(500).json({ error: 'Failed to get specialist handoff stats: ' + error.message });
  }
});

// Get agent cost - parses actual session JSONL files for accurate cost
app.get('/api/agents/:id/cost', (req, res) => {
  try {
    const agentId = req.params.id;
    const agentState = getAgentState(agentId);

    if (!agentState) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Calculate cost from session JSONL files
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = agentState.model || '';

    // Find the Claude project directory for this agent's workspace
    const homeDir = process.env.HOME || homedir();
    const claudeProjectsDir = join(homeDir, '.claude', 'projects');
    const workspacePath = agentState.workspace;

    if (workspacePath) {
      // Claude uses the workspace path as the project directory hash
      const projectDirName = `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`;
      const projectDir = join(claudeProjectsDir, projectDirName);
      const sessionsIndexPath = join(projectDir, 'sessions-index.json');

      if (existsSync(sessionsIndexPath)) {
        try {
          const indexContent = JSON.parse(readFileSync(sessionsIndexPath, 'utf-8'));

          // Parse ALL sessions for this workspace (agent may have multiple sessions)
          for (const sessionEntry of (indexContent.entries || [])) {
            if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
              const jsonlContent = readFileSync(sessionEntry.fullPath, 'utf-8');
              const lines = jsonlContent.split('\n').filter((l: string) => l.trim());

              for (const line of lines) {
                try {
                  const entry = JSON.parse(line);
                  // Extract usage from message.usage or top-level usage
                  const usage = entry.message?.usage || entry.usage;
                  const model = entry.message?.model || entry.model;

                  if (usage) {
                    inputTokens += usage.input_tokens || 0;
                    outputTokens += usage.output_tokens || 0;
                    cacheReadTokens += usage.cache_read_input_tokens || 0;
                    cacheWriteTokens += usage.cache_creation_input_tokens || 0;
                  }
                  // Track the model being used
                  if (model && !detectedModel) {
                    detectedModel = model;
                  }
                } catch {
                  // Skip malformed lines
                }
              }
            }
          }
        } catch {
          // Failed to parse sessions index
        }
      }
    }

    // Calculate cost from usage using pricing data
    if (inputTokens > 0 || outputTokens > 0) {
      const modelInfo = normalizeModelName(detectedModel || 'claude-sonnet-4');
      const pricing = getPricing(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCost(usage, pricing);
      }
    }

    res.json({
      agentId,
      model: detectedModel || agentState.model,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
      },
      cost,
    });
  } catch (error: any) {
    console.error('Error getting agent cost:', error);
    res.status(500).json({ error: 'Failed to get agent cost: ' + error.message });
  }
});

// Get cost summary
app.get('/api/costs/summary', (req, res) => {
  try {
    // TODO: Aggregate costs from all agents
    res.json({
      totalCost: 0,
      byModel: {
        opus: 0,
        sonnet: 0,
        haiku: 0,
      },
      byAgent: {},
      today: 0,
      thisWeek: 0,
    });
  } catch (error: any) {
    console.error('Error getting cost summary:', error);
    res.status(500).json({ error: 'Failed to get cost summary: ' + error.message });
  }
});

// Get container status for workspace
// Get container status (ASYNC - non-blocking)
async function getContainerStatusAsync(issueId: string): Promise<Record<string, { running: boolean; uptime: string | null }>> {
  const issueLower = issueId.toLowerCase();
  const containerMap: Record<string, string[]> = {
    'frontend': ['frontend', 'fe'],
    'api': ['api'],
    'postgres': ['postgres'],
    'redis': ['redis'],
    // Note: 'dev' is a script (./dev), not a container - don't check for it
  };

  // Build all possible container patterns
  // Project names are slugified (e.g., "Mind Your Now" -> "mind-your-now")
  const checks: Array<{ displayName: string; containerName: string }> = [];
  for (const [displayName, suffixes] of Object.entries(containerMap)) {
    for (const suffix of suffixes) {
      checks.push(
        // New naming: ${projectName}-feature-${issueLower}-${suffix}-1
        { displayName, containerName: `mind-your-now-feature-${issueLower}-${suffix}-1` },
        // Legacy naming patterns
        { displayName, containerName: `myn-feature-${issueLower}-${suffix}-1` },
        { displayName, containerName: `feature-${issueLower}-${suffix}-1` },
        { displayName, containerName: `${issueLower}-${suffix}-1` },
      );
    }
  }

  // Run all docker checks in parallel
  // Use 'docker ps' (not -a) to only show RUNNING containers
  // This avoids matching stopped containers with old naming patterns
  const results = await Promise.all(
    checks.map(async ({ displayName, containerName }) => {
      try {
        const { stdout } = await execAsync(
          `docker ps --filter "name=${containerName}" --format "{{.Status}}" 2>/dev/null || echo ""`
        );
        return { displayName, containerName, output: stdout.trim() };
      } catch {
        return { displayName, containerName, output: '' };
      }
    })
  );

  // Process results - first match wins for each display name
  const status: Record<string, { running: boolean; uptime: string | null }> = {};
  for (const displayName of Object.keys(containerMap)) {
    const match = results.find(r => r.displayName === displayName && r.output);
    if (match) {
      // Since we use 'docker ps' (running only), any match is running
      const uptime = match.output.replace(/^Up\s+/, '').split(/\s+/)[0] || null;
      status[displayName] = { running: true, uptime };
    } else {
      status[displayName] = { running: false, uptime: null };
    }
  }

  return status;
}

// Get MR URL for an issue from GitLab (ASYNC - non-blocking)
async function getMrUrlAsync(issueId: string, workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`glab mr list -A -F json 2>/dev/null || echo "[]"`, {
      cwd: workspacePath,
      maxBuffer: 10 * 1024 * 1024,
    });

    const mrs = JSON.parse(stdout);
    for (const mr of mrs) {
      const branchMatch = mr.source_branch?.match(/feature\/(\w+-\d+)/i);
      if (branchMatch && branchMatch[1].toUpperCase() === issueId.toUpperCase()) {
        return mr.web_url;
      }
    }
  } catch {}

  return null;
}

// Synchronous version for backwards compatibility
async function getMrUrl(issueId: string, workspacePath: string): Promise<string | null> {
  try {
    // Try to get MR from glab
    const { stdout: output } = await execAsync(`glab mr list -A -F json 2>/dev/null || echo "[]"`, {
      encoding: 'utf-8',
      cwd: workspacePath,
      maxBuffer: 10 * 1024 * 1024,
    });

    const mrs = JSON.parse(output);
    for (const mr of mrs) {
      // Match by source branch (e.g., feature/min-609 -> MIN-609)
      const branchMatch = mr.source_branch?.match(/feature\/(\w+-\d+)/i);
      if (branchMatch && branchMatch[1].toUpperCase() === issueId.toUpperCase()) {
        return mr.web_url;
      }
    }
  } catch {}

  return null;
}

// Get git status for sub-repos (ASYNC - non-blocking)
async function getRepoGitStatusAsync(workspacePath: string): Promise<{
  frontend: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
  api: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
}> {
  const result: {
    frontend: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
    api: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
  } = { frontend: null, api: null };

  const repoPaths = [
    { key: 'frontend', paths: ['fe', 'frontend'] },
    { key: 'api', paths: ['api', 'backend'] },
  ];

  // Find which paths exist first (sync but fast)
  const existingRepos: Array<{ key: string; repoDir: string }> = [];
  for (const { key, paths } of repoPaths) {
    for (const subdir of paths) {
      const repoDir = join(workspacePath, subdir);
      if (existsSync(repoDir)) {
        existingRepos.push({ key, repoDir });
        break; // First match wins
      }
    }
  }

  // Run all git commands in parallel for all repos
  const gitResults = await Promise.all(
    existingRepos.map(async ({ key, repoDir }) => {
      try {
        const [branchResult, uncommittedResult, commitResult] = await Promise.all([
          execAsync('git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""', { cwd: repoDir }),
          execAsync('git status --porcelain 2>/dev/null | wc -l', { cwd: repoDir }),
          execAsync('git log -1 --pretty=format:"%s" 2>/dev/null || echo ""', { cwd: repoDir }),
        ]);
        return {
          key,
          branch: branchResult.stdout.trim(),
          uncommitted: uncommittedResult.stdout.trim(),
          latestCommit: commitResult.stdout.trim(),
        };
      } catch {
        return null;
      }
    })
  );

  for (const gitResult of gitResults) {
    if (gitResult && gitResult.branch) {
      result[gitResult.key as 'frontend' | 'api'] = {
        branch: gitResult.branch,
        uncommittedFiles: parseInt(gitResult.uncommitted, 10) || 0,
        latestCommit: gitResult.latestCommit.slice(0, 60) + (gitResult.latestCommit.length > 60 ? '...' : ''),
      };
    }
  }

  return result;
}

// Get workspace info for an issue (ASYNC - non-blocking for terminal performance)
app.get('/api/workspaces/:issueId', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Check for remote workspace first
  const workspaceInfo = getWorkspaceInfoForIssue(issueId);

  // If remote workspace exists, return info about it
  if (workspaceInfo.isRemote && workspaceInfo.vmName) {
    return res.json({
      exists: true,
      issueId,
      isRemote: true,
      vmName: workspaceInfo.vmName,
      remotePath: workspaceInfo.remotePath,
      agentId: workspaceInfo.agentId,
      path: `${workspaceInfo.vmName}:${workspaceInfo.remotePath}`,
      location: 'remote',
      message: `Workspace is on remote VM: ${workspaceInfo.vmName}.exe.xyz`,
    });
  }

  // Convert issue ID to workspace path (e.g., MIN-645 -> feature-min-645)
  const workspaceName = `feature-${issueLower}`;
  const workspacePath = join(projectPath, 'workspaces', workspaceName);

  if (!existsSync(workspacePath)) {
    return res.json({ exists: false, issueId });
  }

  // Check if workspace is valid (has git, devcontainer, or CLAUDE.md)
  // MYN monorepo style has .git in subdirs (api/.git, fe/.git), not at root
  const gitFile = join(workspacePath, '.git');
  const apiGit = join(workspacePath, 'api', '.git');
  const feGit = join(workspacePath, 'fe', '.git');
  const srcGit = join(workspacePath, 'src', '.git');
  const devcontainer = join(workspacePath, '.devcontainer');
  const claudeMd = join(workspacePath, 'CLAUDE.md');

  const hasValidStructure = existsSync(gitFile) ||       // Standard git worktree
                            existsSync(apiGit) ||         // MYN monorepo (api subdir)
                            existsSync(feGit) ||          // MYN monorepo (fe subdir)
                            existsSync(srcGit) ||         // Other monorepo patterns
                            existsSync(devcontainer) ||   // Containerized workspace
                            existsSync(claudeMd);         // Panopticon workspace

  if (!hasValidStructure) {
    // Get workspace location even for corrupted workspaces
    const location = getWorkspaceLocation(issueId);
    return res.json({
      exists: true,
      corrupted: true,
      issueId,
      path: workspacePath,
      message: 'Workspace exists but is not a valid git worktree or containerized workspace',
      location,
    });
  }

  // Construct service URLs based on project DNS configuration
  const projectConfig = findProjectByTeam(issuePrefix);
  const dnsDomain = projectConfig?.workspace?.dns?.domain || 'localhost';
  const featureFolder = `feature-${issueLower}`;

  // Use DNS entries from config if available, otherwise construct defaults
  let frontendUrl = `https://${featureFolder}.${dnsDomain}`;
  let apiUrl = `https://api-${featureFolder}.${dnsDomain}`;

  // If project has explicit DNS entries pattern, use those
  if (projectConfig?.workspace?.dns?.entries) {
    const entries = projectConfig.workspace.dns.entries;
    // First entry is typically frontend, second is API
    if (entries[0]) {
      frontendUrl = `https://${entries[0].replace('{{FEATURE_FOLDER}}', featureFolder)}`;
    }
    if (entries[1]) {
      apiUrl = `https://${entries[1].replace('{{FEATURE_FOLDER}}', featureFolder)}`;
    }
  }

  // Check for WORKSPACE.md to get custom service URLs
  let services: { name: string; url?: string }[] = [];
  const workspaceMd = join(workspacePath, 'WORKSPACE.md');
  const dockerCompose = join(workspacePath, 'docker-compose.yml');

  // Try to extract service URLs from WORKSPACE.md if it exists
  if (existsSync(workspaceMd)) {
    try {
      const content = readFileSync(workspaceMd, 'utf-8');
      // Look for URLs in the format: Frontend: http://... or Backend: http://...
      const urlMatches = content.matchAll(/(\w+):\s*(https?:\/\/[^\s\n]+)/gi);
      for (const match of urlMatches) {
        services.push({ name: match[1], url: match[2] });
      }
    } catch {}
  }

  // If no services from WORKSPACE.md, use constructed URLs
  if (services.length === 0) {
    services = [
      { name: 'Frontend', url: frontendUrl },
      { name: 'API', url: apiUrl },
    ];
  }

  // Check if docker-compose exists (indicates containerized workspace)
  // Look in multiple places: root, .devcontainer (with various naming conventions)
  const devcontainerPath = join(workspacePath, '.devcontainer');
  const hasDocker = existsSync(dockerCompose) ||
                    existsSync(join(workspacePath, 'docker-compose.yml')) ||
                    existsSync(join(workspacePath, 'compose.yaml')) ||
                    existsSync(join(devcontainerPath, 'docker-compose.yml')) ||
                    existsSync(join(devcontainerPath, 'docker-compose.devcontainer.yml')) ||
                    existsSync(join(devcontainerPath, 'compose.yaml')) ||
                    existsSync(join(devcontainerPath, 'compose.infra.yml')) ||
                    existsSync(devcontainerPath); // .devcontainer dir exists = containerized

  // Check if project supports containerization (has new-feature script)
  const canContainerize = !hasDocker && existsSync(join(projectPath, 'infra', 'new-feature'));

  // Run all async operations in parallel to minimize blocking
  const agentSession = `agent-${issueLower}`;
  const [git, repoGit, containers, mrUrl, sessionsResult, paneResult] = await Promise.all([
    getGitStatusAsync(workspacePath),
    getRepoGitStatusAsync(workspacePath),
    hasDocker ? getContainerStatusAsync(issueId) : Promise.resolve(null),
    getMrUrlAsync(issueId, workspacePath),
    execAsync('tmux list-sessions 2>/dev/null || echo ""').catch(() => ({ stdout: '' })),
    execAsync(`tmux capture-pane -t "${agentSession}" -p 2>/dev/null | tail -50`).catch(() => ({ stdout: '' })),
  ]);

  // Check for running agent from async results
  let hasAgent = false;
  let agentSessionId: string | null = null;
  let agentModel: string | undefined;
  let agentModelFull: string | undefined;

  const sessions = sessionsResult.stdout;
  if (sessions.includes(agentSession)) {
    hasAgent = true;
    agentSessionId = agentSession;

    const paneOutput = paneResult.stdout;
    const modelMatch = paneOutput.match(/\[(Opus|Sonnet|Haiku)[^\]]*\]/i);
    agentModel = modelMatch ? modelMatch[1] : undefined;

    // Get full model ID from session files
    if (workspacePath) {
      const fullModel = getActiveSessionModel(workspacePath);
      if (fullModel) {
        agentModelFull = fullModel;
      }
    }
  }

  // Get any pending operation for this issue
  const pendingOperation = getPendingOperation(issueId);

  // Get workspace location (local vs remote)
  const location = getWorkspaceLocation(issueId);

  res.json({
    exists: true,
    issueId,
    path: workspacePath,
    frontendUrl,
    apiUrl,
    mrUrl,
    hasAgent,
    agentSessionId,
    agentModel,
    agentModelFull,
    git,
    repoGit,
    services,
    containers,
    hasDocker,
    canContainerize,
    pendingOperation,
    location,
  });
});

// Create workspace (without agent)
app.post('/api/workspaces', (req, res) => {
  const { issueId, projectId } = req.body;

  if (!issueId) {
    return res.status(400).json({ error: 'issueId required' });
  }

  try {
    // Extract prefix from issue ID (e.g., "MIN" from "MIN-645")
    const issuePrefix = issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);
    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Create workspace for ${issueId}`,
      projectPath
    );

    res.json({
      success: true,
      message: `Creating workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  } catch (error: any) {
    console.error('Error creating workspace:', error);
    res.status(500).json({ error: 'Failed to create workspace: ' + error.message });
  }
});

// Preview what would be lost when cleaning a corrupted workspace
// Includes diff analysis against main branch to identify actual changes
app.get('/api/workspaces/:issueId/clean/preview', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspaceName = `feature-${issueLower}`;
  const workspacePath = join(projectPath, 'workspaces', workspaceName);

  try {
    if (!existsSync(workspacePath)) {
      return res.status(404).json({ error: 'Workspace does not exist' });
    }

    // Get list of files (excluding common build artifacts)
    const excludeDirs = ['node_modules', 'target', 'dist', 'build', '.git', '__pycache__', '.cache', '.next', 'coverage'];
    const excludePattern = excludeDirs.map(d => `-name "${d}" -prune`).join(' -o ');

    // Find all files, excluding build artifacts
    const findCmd = `find "${workspacePath}" \\( ${excludePattern} \\) -o -type f -print 2>/dev/null | head -500`;
    const { stdout: filesOutput } = await execAsync(findCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    const files = filesOutput.trim() ? filesOutput.trim().split('\n').map(f => f.replace(workspacePath + '/', '')) : [];

    // Get total size (excluding node_modules etc)
    let totalSize = '0';
    try {
      const duCmd = `du -sh "${workspacePath}" --exclude=node_modules --exclude=target --exclude=dist --exclude=.git 2>/dev/null | cut -f1`;
      const { stdout: sizeOutput } = await execAsync(duCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      totalSize = sizeOutput.trim() || '0';
    } catch {
      totalSize = 'unknown';
    }

    // Categorize files by type
    const codeFiles = files.filter(f => /\.(ts|tsx|js|jsx|java|py|rs|go|rb|php|cs|swift|kt)$/.test(f));
    const configFiles = files.filter(f => /\.(json|yaml|yml|toml|xml|env|md)$/.test(f) || f.includes('config'));
    const otherFiles = files.filter(f => !codeFiles.includes(f) && !configFiles.includes(f));

    // Diff analysis: compare workspace files against main branch
    // This helps identify what's actually been changed vs what would be recreated
    let diffAnalysis: {
      modifiedFiles: string[];
      newFiles: string[];
      unchangedFiles: string[];
      comparedAgainst: string;
      error?: string;
    } = {
      modifiedFiles: [],
      newFiles: [],
      unchangedFiles: [],
      comparedAgainst: 'main',
    };

    try {
      // Detect multi-repo structure (e.g., MYN has separate fe/ and api/ repos)
      const subrepos: { prefix: string; gitRoot: string }[] = [];
      const possibleSubrepos = ['fe', 'api', 'frontend', 'backend', 'web', 'server'];

      for (const subdir of possibleSubrepos) {
        const subdirPath = join(workspacePath, subdir);
        if (existsSync(join(subdirPath, '.git'))) {
          subrepos.push({ prefix: subdir + '/', gitRoot: subdirPath });
        }
      }

      // Also check for main repo git
      let mainGitRoot: string | null = null;
      const possibleRoots = [projectPath, join(projectPath, '..'), workspacePath];
      for (const root of possibleRoots) {
        if (existsSync(join(root, '.git'))) {
          mainGitRoot = root;
          break;
        }
      }

      // Sample up to 100 code files for diff analysis
      const filesToCheck = codeFiles.slice(0, 100);
      const reposUsed: string[] = [];

      for (const file of filesToCheck) {
        const workspaceFilePath = join(workspacePath, file);

        // Find which repo this file belongs to
        let gitRoot: string | null = null;
        let relativePath = file;

        // Check subrepos first
        for (const { prefix, gitRoot: subGitRoot } of subrepos) {
          if (file.startsWith(prefix)) {
            gitRoot = subGitRoot;
            relativePath = file.slice(prefix.length);
            if (!reposUsed.includes(prefix)) reposUsed.push(prefix);
            break;
          }
        }

        // Fall back to main repo
        if (!gitRoot && mainGitRoot) {
          gitRoot = mainGitRoot;
          if (!reposUsed.includes('main')) reposUsed.push('main');
        }

        if (!gitRoot) {
          diffAnalysis.newFiles.push(file);
          continue;
        }

        try {
          // Check if feature branch exists in this repo
          const branchName = `feature/${issueLower}`;
          let compareRef = 'main';
          try {
            await execAsync(`git rev-parse --verify ${branchName} 2>/dev/null`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            compareRef = branchName;
          } catch {
            // Try master if main doesn't exist
            try {
              await execAsync(`git rev-parse --verify main 2>/dev/null`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            } catch {
              compareRef = 'master';
            }
          }

          // Try to get file content from git
          const { stdout: gitContent } = await execAsync(
            `git show ${compareRef}:${relativePath} 2>/dev/null`,
            { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
          );

          // Compare with workspace file
          const workspaceContent = readFileSync(workspaceFilePath, 'utf-8');

          if (gitContent === workspaceContent) {
            diffAnalysis.unchangedFiles.push(file);
          } else {
            diffAnalysis.modifiedFiles.push(file);
          }
        } catch {
          // File doesn't exist in git - it's a new file
          diffAnalysis.newFiles.push(file);
        }
      }

      diffAnalysis.comparedAgainst = reposUsed.length > 0
        ? `${reposUsed.join(', ')} repos (main branch)`
        : 'main';

      if (subrepos.length === 0 && !mainGitRoot) {
        diffAnalysis.error = 'Could not find git repository to compare against';
      }
    } catch (diffError: any) {
      diffAnalysis.error = `Diff analysis failed: ${diffError.message}`;
    }

    res.json({
      workspacePath,
      totalSize,
      fileCount: files.length,
      codeFiles: codeFiles.slice(0, 50),
      configFiles: configFiles.slice(0, 30),
      otherFiles: otherFiles.slice(0, 20),
      hasMore: files.length > 100,
      backupPath: join(projectPath, 'workspaces', `.backup-${workspaceName}-${Date.now()}`),
      // Diff analysis results
      diffAnalysis,
    });
  } catch (error: any) {
    console.error('Error previewing workspace:', error);
    res.status(500).json({ error: 'Failed to preview workspace: ' + error.message });
  }
});

// Clean and recreate a corrupted workspace
app.post('/api/workspaces/:issueId/clean', async (req, res) => {
  const { issueId } = req.params;
  const { createBackup } = req.body || {};
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspaceName = `feature-${issueLower}`;
  const workspacePath = join(projectPath, 'workspaces', workspaceName);

  try {
    // Check if workspace exists
    if (!existsSync(workspacePath)) {
      return res.status(404).json({ error: 'Workspace does not exist' });
    }

    let backupPath: string | null = null;

    // Create backup if requested
    if (createBackup) {
      backupPath = join(projectPath, 'workspaces', `.backup-${workspaceName}-${Date.now()}`);
      console.log(`Creating backup: ${workspacePath} -> ${backupPath}`);

      // Copy workspace to backup (excluding node_modules, target, etc. to save space)
      await execAsync(
        `rsync -a --quiet --exclude=node_modules --exclude=target --exclude=dist --exclude=.git --exclude=__pycache__ --exclude=.cache --exclude=.next --exclude=coverage "${workspacePath}/" "${backupPath}/"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      );
    }

    // Remove the corrupted workspace directory
    // If regular rm fails (files owned by root from Docker), use Docker to clean up
    console.log(`Removing corrupted workspace: ${workspacePath}`);
    try {
      await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    } catch (rmError: any) {
      console.log('Regular rm failed, using Docker to clean up root-owned files...');
      // Use Alpine container to remove contents as root inside Docker (no sudo needed on host)
      // Note: Can't remove /cleanup itself (mount point), so remove contents then rmdir from host
      await execAsync(
        `docker run --rm -v "${workspacePath}:/cleanup" alpine sh -c "rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      );
      // Now remove the empty directory from host
      await execAsync(`rmdir "${workspacePath}"`, { encoding: 'utf-8' });
    }

    // Create fresh workspace using pan command
    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Recreate workspace for ${issueId}`,
      projectPath
    );

    res.json({
      success: true,
      message: createBackup
        ? `Backed up to ${backupPath} and recreating workspace for ${issueId}`
        : `Cleaned corrupted workspace and recreating for ${issueId}`,
      activityId,
      projectPath,
      backupPath,
    });
  } catch (error: any) {
    console.error('Error cleaning workspace:', error);
    res.status(500).json({ error: 'Failed to clean workspace: ' + error.message });
  }
});

// Containerize an existing workspace (runs project's new-feature script)
app.post('/api/workspaces/:issueId/containerize', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Check if new-feature script exists
  const newFeatureScript = join(projectPath, 'infra', 'new-feature');
  if (!existsSync(newFeatureScript)) {
    return res.status(400).json({
      error: 'Project does not support containerization (no infra/new-feature script)',
    });
  }

  // Check if already containerized
  const workspaceName = `feature-${issueLower}`;
  const workspacePath = join(projectPath, 'workspaces', workspaceName);
  if (existsSync(join(workspacePath, '.devcontainer'))) {
    return res.status(400).json({
      error: 'Workspace is already containerized',
    });
  }

  // Check if Docker is running (required for containerization)
  try {
    await execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
  } catch {
    return res.status(400).json({
      error: 'Docker is not running. Start Docker Desktop first.',
    });
  }

  try {
    // First, remove the git-only workspace if it exists
    // The new-feature script will create a proper containerized one
    if (existsSync(workspacePath)) {
      // Run pan workspace destroy first to clean up the git worktree
      await execAsync(`pan workspace destroy ${issueId} --force 2>/dev/null || true`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });
    }

    // Run the new-feature script from the infra directory
    // Extract just the issue identifier (e.g., "min-645" from "MIN-645")
    const featureName = issueLower;
    const activityId = Date.now().toString();

    // Add to activity log immediately as running
    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./new-feature ${featureName}`,
      status: 'running',
      output: [],
    });

    // Spawn the new-feature script
    const child = spawn('./new-feature', [featureName], {
      cwd: join(projectPath, 'infra'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(activityId, `[${new Date().toISOString()}] new-feature exited with code ${code}`);

      if (code === 0) {
        // Now start the containers
        appendActivityOutput(activityId, '');
        appendActivityOutput(activityId, '=== Starting containers ===');

        const workspaceDir = join(projectPath, 'workspaces', `feature-${featureName}`);
        // Pass UID/GID for correct file ownership in containers
        const uid = process.getuid?.() ?? 1000;
        const gid = process.getgid?.() ?? 1000;
        const devUp = spawn('./dev', ['all'], {
          cwd: workspaceDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, UID: String(uid), GID: String(gid), DOCKER_USER: `${uid}:${gid}` },
        });

        devUp.stdout?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, line);
          });
        });
        devUp.stderr?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, `[stderr] ${line}`);
          });
        });

        devUp.on('close', (devCode) => {
          appendActivityOutput(activityId, `[${new Date().toISOString()}] ./dev all exited with code ${devCode}`);
          updateActivity(activityId, { status: devCode === 0 ? 'completed' : 'failed' });
        });

        devUp.on('error', (err) => {
          appendActivityOutput(activityId, `[error] ${err.message}`);
          updateActivity(activityId, { status: 'failed' });
        });
      } else {
        updateActivity(activityId, { status: 'failed' });
      }
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    res.json({
      success: true,
      message: `Containerizing workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  } catch (error: any) {
    console.error('Error containerizing workspace:', error);
    res.status(500).json({ error: 'Failed to containerize workspace: ' + error.message });
  }
});

// Start containers for an existing workspace
app.post('/api/workspaces/:issueId/start', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  // Check workspace exists
  if (!existsSync(workspacePath)) {
    return res.status(400).json({ error: 'Workspace does not exist' });
  }

  // Check for ./dev script - repair if needed (older workspaces may lack symlink)
  const devScript = join(workspacePath, 'dev');
  const devScriptInContainer = join(workspacePath, '.devcontainer', 'dev');

  if (!existsSync(devScript)) {
    // Try to repair: create symlink if .devcontainer/dev exists
    if (existsSync(devScriptInContainer)) {
      try {
        symlinkSync('.devcontainer/dev', devScript);
        chmodSync(devScriptInContainer, 0o755); // Ensure executable
        console.log(`[workspace/start] Repaired: created ./dev symlink for ${issueId}`);
      } catch (repairErr) {
        return res.status(400).json({
          error: `Workspace has no ./dev script and repair failed: ${repairErr}`
        });
      }
    } else {
      return res.status(400).json({ error: 'Workspace has no ./dev script (checked root and .devcontainer/)' });
    }
  }

  // Repair workspace .env file if needed (older workspaces may lack port assignments)
  // This prevents port conflicts between workspaces
  const envFilePath = join(workspacePath, '.env');
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

  if (projectConfig?.workspace?.ports && projectConfig?.workspace?.env?.template) {
    const featureFolder = `feature-${issueLower}`;
    let needsRepair = !existsSync(envFilePath);

    // Check if env file is missing required port variables
    if (!needsRepair && existsSync(envFilePath)) {
      const existingEnv = readFileSync(envFilePath, 'utf-8');
      for (const portName of Object.keys(projectConfig.workspace.ports)) {
        const portVar = `${portName.toUpperCase()}_PORT`;
        if (!existingEnv.includes(portVar)) {
          needsRepair = true;
          break;
        }
      }
    }

    if (needsRepair) {
      try {
        // Assign ports from configured ranges
        const placeholders: Record<string, string> = {
          FEATURE_FOLDER: featureFolder,
        };

        for (const [portName, portConfig] of Object.entries(projectConfig.workspace.ports)) {
          const portFile = join(projectPath, `.${portName}-ports`);
          const range = portConfig.range as [number, number];

          // Read existing assignments
          let content = '';
          if (existsSync(portFile)) {
            content = readFileSync(portFile, 'utf-8');
          }

          // Check if already assigned
          const lines = content.split('\n').filter(Boolean);
          let port: number | null = null;
          for (const line of lines) {
            const [folder, p] = line.split(':');
            if (folder === featureFolder) {
              port = parseInt(p, 10);
              break;
            }
          }

          // Find next available port if not assigned
          if (!port) {
            const usedPorts = new Set(lines.map(l => parseInt(l.split(':')[1], 10)));
            for (let p = range[0]; p <= range[1]; p++) {
              if (!usedPorts.has(p)) {
                port = p;
                writeFileSync(portFile, content + (content.endsWith('\n') || !content ? '' : '\n') + `${featureFolder}:${port}\n`);
                break;
              }
            }
          }

          if (port) {
            placeholders[`${portName.toUpperCase()}_PORT`] = String(port);
          }
        }

        // Generate .env content from template
        let envContent = projectConfig.workspace.env.template;
        for (const [key, value] of Object.entries(placeholders)) {
          envContent = envContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        writeFileSync(envFilePath, envContent);
        console.log(`[workspace/start] Repaired: created .env with port assignments for ${issueId}`);
      } catch (envErr) {
        console.warn(`[workspace/start] Could not repair .env for ${issueId}: ${envErr}`);
        // Continue anyway - Docker might still work with defaults
      }
    }
  }

  // Check if Docker is running
  try {
    await execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
  } catch {
    return res.status(400).json({ error: 'Docker is not running. Start Docker Desktop first.' });
  }

  try {
    const activityId = Date.now().toString();

    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./dev all (${issueId})`,
      status: 'running',
      output: [],
    });

    // Pass UID/GID to ensure Docker containers create files with correct ownership
    // Projects should use: user: "${UID}:${GID}" in docker-compose.yml
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;

    const child = spawn('./dev', ['all'], {
      cwd: workspacePath,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        UID: String(uid),
        GID: String(gid),
        // Also set DOCKER_USER for compatibility with different docker-compose patterns
        DOCKER_USER: `${uid}:${gid}`,
      },
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(activityId, `[${new Date().toISOString()}] ./dev all exited with code ${code}`);
      updateActivity(activityId, { status: code === 0 ? 'completed' : 'failed' });
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    res.json({
      success: true,
      message: `Starting containers for ${issueId}`,
      activityId,
    });
  } catch (error: any) {
    console.error('Error starting containers:', error);
    res.status(500).json({ error: 'Failed to start containers: ' + error.message });
  }
});

// Control individual container (start/stop/restart)
app.post('/api/workspaces/:issueId/containers/:containerName/:action', async (req, res) => {
  const { issueId, containerName, action } = req.params;

  // Validate action
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be start, stop, or restart.' });
  }

  // Find workspace and compose file
  const projectPaths = [
    join(homedir(), 'projects/myn/workspaces', `feature-${issueId.toLowerCase()}`),
    join(homedir(), 'projects/panopticon/workspaces', `feature-${issueId.toLowerCase()}`),
  ];

  let workspacePath: string | null = null;
  let composeFile: string | null = null;

  for (const path of projectPaths) {
    if (existsSync(path)) {
      workspacePath = path;
      // Check for compose file in common locations
      const composePaths = [
        join(path, '.devcontainer/docker-compose.devcontainer.yml'),
        join(path, 'docker-compose.yml'),
        join(path, 'docker-compose.yaml'),
      ];
      for (const cp of composePaths) {
        if (existsSync(cp)) {
          composeFile = cp;
          break;
        }
      }
      break;
    }
  }

  if (!workspacePath) {
    return res.status(404).json({ error: `Workspace not found for ${issueId}` });
  }

  if (!composeFile) {
    return res.status(404).json({ error: `No docker-compose file found in workspace` });
  }

  // Check Docker is running
  try {
    await execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
  } catch {
    return res.status(400).json({ error: 'Docker is not running. Start Docker Desktop first.' });
  }

  // Map display name to service name(s) - some services have aliases
  const serviceMap: Record<string, string[]> = {
    'frontend': ['fe', 'frontend'],
    'api': ['api'],
    'dev': ['dev'],
    'postgres': ['postgres'],
    'redis': ['redis'],
    'fe': ['fe', 'frontend'],
  };

  const serviceNames = serviceMap[containerName.toLowerCase()] || [containerName.toLowerCase()];

  try {
    // Get the project name from compose
    const { stdout: projectNameOut } = await execAsync(
      `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
      { encoding: 'utf-8' }
    );
    const projectName = projectNameOut.trim();

    // Try each possible service name
    let success = false;
    let lastError = '';

    for (const serviceName of serviceNames) {
      try {
        const cmd = `docker compose -f "${composeFile}" ${projectName ? `--project-name "${projectName}"` : ''} ${action} ${serviceName}`;
        console.log(`[container-control] Running: ${cmd}`);
        await execAsync(cmd, { encoding: 'utf-8', timeout: 30000 });
        success = true;
        console.log(`[container-control] Successfully ${action}ed ${serviceName} for ${issueId}`);
        break;
      } catch (err: any) {
        lastError = err.message || String(err);
        // Continue trying other service names
      }
    }

    if (success) {
      res.json({ success: true, message: `Container ${containerName} ${action}ed successfully` });
    } else {
      res.status(500).json({ error: `Failed to ${action} ${containerName}: ${lastError}` });
    }
  } catch (error: any) {
    console.error(`Error ${action}ing container:`, error);
    res.status(500).json({ error: `Failed to ${action} container: ${error.message}` });
  }
});

// Get review status for a workspace
app.get('/api/workspaces/:issueId/review-status', (req, res) => {
  const { issueId } = req.params;
  const status = getReviewStatus(issueId);
  res.json(status || {
    issueId,
    reviewStatus: 'pending',
    testStatus: 'pending',
    readyForMerge: false,
  });
});

// Update review status (called by specialists via CLI)
app.post('/api/workspaces/:issueId/review-status', async (req, res) => {
  const { issueId } = req.params;
  const { reviewStatus, testStatus, mergeStatus, reviewNotes, testNotes } = req.body;

  const update: Partial<ReviewStatus> = {};
  if (reviewStatus) update.reviewStatus = reviewStatus;
  if (testStatus) update.testStatus = testStatus;
  if (mergeStatus) update.mergeStatus = mergeStatus;
  if (reviewNotes) update.reviewNotes = reviewNotes;
  if (testNotes) update.testNotes = testNotes;

  const status = setReviewStatus(issueId, update);
  console.log(`[review-status] Updated ${issueId}:`, status);

  // Set specialist state to idle when they report completion
  // Infer which specialist based on which field was updated
  const { getTmuxSessionName, checkSpecialistQueue, completeSpecialistTask } = await import('../../lib/cloister/specialists.js');

  if (reviewStatus && ['passed', 'blocked', 'failed'].includes(reviewStatus)) {
    const tmuxSession = getTmuxSessionName('review-agent');
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    console.log(`[review-status] Set review-agent to idle`);

    // Clear this issue from review-agent queue (prevents orphaned queue items)
    const queue = checkSpecialistQueue('review-agent');
    for (const item of queue.items) {
      if (item.payload?.issueId?.toLowerCase() === issueId.toLowerCase()) {
        completeSpecialistTask('review-agent', item.id);
        console.log(`[review-status] Cleared ${issueId} from review-agent queue`);
      }
    }

    // Auto-send feedback to work agent when blocked/failed (guarantees delivery)
    if (['blocked', 'failed'].includes(reviewStatus) && reviewNotes) {
      const agentId = `agent-${issueId.toLowerCase()}`;
      try {
        const { messageAgent } = await import('../../lib/agents.js');
        const feedback = `CODE REVIEW ${reviewStatus.toUpperCase()} for ${issueId}:\n\n${reviewNotes}\n\nPlease address these issues and re-request review.`;
        await messageAgent(agentId, feedback);
        console.log(`[review-status] Auto-sent feedback to ${agentId}`);
      } catch (err) {
        console.log(`[review-status] Work agent ${agentId} not running or suspended, feedback saved to mail queue`);
        console.error(`[review-status] Failed to send feedback to ${agentId}:`, err);
      }
    }

    // Auto-queue test-agent when review passes (server-side guarantee)
    // This ensures test-agent is always triggered regardless of which prompt the review-agent used
    if (reviewStatus === 'passed') {
      try {
        const { wakeSpecialistOrQueue, checkSpecialistQueue: checkTestQueue } = await import('../../lib/cloister/specialists.js');

        // Dedup: check if test-agent already has this issue queued
        const testQueue = checkTestQueue('test-agent');
        const alreadyQueued = testQueue.items.some(
          (item: any) => item.payload?.issueId?.toLowerCase() === issueId.toLowerCase()
        );

        if (!alreadyQueued) {
          // Derive workspace/branch from issueId (review-agent doesn't send these)
          const issueLower = issueId.toLowerCase();
          const issuePrefix = issueId.split('-')[0];
          const projectPath = getProjectPath(undefined, issuePrefix);
          const testWorkspace = req.body.workspace || join(projectPath, 'workspaces', `feature-${issueLower}`);
          const testBranch = req.body.branch || `feature/${issueLower}`;

          const testResult = await wakeSpecialistOrQueue('test-agent', {
            issueId,
            workspace: testWorkspace,
            branch: testBranch,
          }, {
            priority: 'normal',
            source: 'review-passed-auto',
          });
          console.log(`[review-status] Auto-queued test-agent for ${issueId}: ${testResult.action}`);
        } else {
          console.log(`[review-status] Test-agent already has ${issueId} queued, skipping`);
        }
      } catch (err) {
        console.error(`[review-status] Failed to auto-queue test-agent for ${issueId}:`, err);
      }
    }

    // Immediately process next queued item (don't wait for deacon patrol)
    // Validate items before waking - skip already-reviewed or merged items
    const remainingQueue = checkSpecialistQueue('review-agent');
    if (remainingQueue.hasWork) {
      const { getNextSpecialistTask, wakeSpecialistWithTask, completeSpecialistTask: completeTask } = await import('../../lib/cloister/specialists.js');

      // Find next VALID task (skip stale items)
      let validTask = null;
      for (const task of remainingQueue.items) {
        const taskIssueId = task.payload?.issueId;
        if (!taskIssueId) {
          completeTask('review-agent', task.id);
          console.log(`[review-status] Removed queue item with no issueId`);
          continue;
        }

        // Skip if already reviewed or merged
        const taskStatus = getReviewStatus(taskIssueId);
        if (taskStatus?.reviewStatus === 'passed') {
          completeTask('review-agent', task.id);
          console.log(`[review-status] Skipping stale queue item: ${taskIssueId} (already reviewed)`);
          continue;
        }
        if (taskStatus?.mergeStatus === 'merged') {
          completeTask('review-agent', task.id);
          console.log(`[review-status] Skipping stale queue item: ${taskIssueId} (already merged)`);
          continue;
        }

        validTask = task;
        break;
      }

      if (validTask) {
        console.log(`[review-status] Immediately waking review-agent for next queued task: ${validTask.payload.issueId}`);
        const taskDetails = {
          issueId: validTask.payload.issueId || '',
          branch: validTask.payload.context?.branch,
          workspace: validTask.payload.context?.workspace,
        };
        const wakeResult = await wakeSpecialistWithTask('review-agent', taskDetails);
        if (wakeResult.success) {
          completeTask('review-agent', validTask.id);
          console.log(`[review-status] Review-agent woken for ${validTask.payload.issueId}`);
        } else {
          console.error(`[review-status] Failed to wake review-agent for next task: ${wakeResult.error}`);
        }
      } else {
        console.log(`[review-status] No valid items remaining in review-agent queue`);
      }
    }
  }

  if (testStatus && ['passed', 'failed', 'skipped'].includes(testStatus)) {
    const tmuxSession = getTmuxSessionName('test-agent');
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    console.log(`[review-status] Set test-agent to idle`);

    // Clear this issue from test-agent queue
    const queue = checkSpecialistQueue('test-agent');
    for (const item of queue.items) {
      if (item.payload?.issueId?.toLowerCase() === issueId.toLowerCase()) {
        completeSpecialistTask('test-agent', item.id);
        console.log(`[review-status] Cleared ${issueId} from test-agent queue`);
      }
    }

    // Auto-send test failure feedback to work agent
    if (testStatus === 'failed' && testNotes) {
      const agentId = `agent-${issueId.toLowerCase()}`;
      try {
        const { messageAgent } = await import('../../lib/agents.js');
        const feedback = `TESTS FAILED for ${issueId}:\n\n${testNotes}\n\nPlease fix the failing tests and re-request review.`;
        await messageAgent(agentId, feedback);
        console.log(`[review-status] Auto-sent test failure to ${agentId}`);
      } catch (err) {
        console.log(`[review-status] Work agent ${agentId} not running or suspended, feedback saved to mail queue`);
        console.error(`[review-status] Failed to send test feedback to ${agentId}:`, err);
      }
    }

    // Immediately process next queued item for test-agent
    // Validate items before waking - skip already-tested or merged items
    const remainingTestQueue = checkSpecialistQueue('test-agent');
    if (remainingTestQueue.hasWork) {
      const { getNextSpecialistTask, wakeSpecialistWithTask, completeSpecialistTask: completeTask } = await import('../../lib/cloister/specialists.js');

      // Find next VALID task (skip stale items)
      let validTestTask = null;
      for (const task of remainingTestQueue.items) {
        const taskIssueId = task.payload?.issueId;
        if (!taskIssueId) {
          completeTask('test-agent', task.id);
          continue;
        }

        const taskStatus = getReviewStatus(taskIssueId);
        if (taskStatus?.testStatus === 'passed') {
          completeTask('test-agent', task.id);
          console.log(`[review-status] Skipping stale test queue item: ${taskIssueId} (already tested)`);
          continue;
        }
        if (taskStatus?.mergeStatus === 'merged') {
          completeTask('test-agent', task.id);
          console.log(`[review-status] Skipping stale test queue item: ${taskIssueId} (already merged)`);
          continue;
        }

        validTestTask = task;
        break;
      }

      if (validTestTask) {
        console.log(`[review-status] Immediately waking test-agent for next queued task: ${validTestTask.payload.issueId}`);
        const taskDetails = {
          issueId: validTestTask.payload.issueId || '',
          branch: validTestTask.payload.context?.branch,
          workspace: validTestTask.payload.context?.workspace,
        };
        const wakeResult = await wakeSpecialistWithTask('test-agent', taskDetails);
        if (wakeResult.success) {
          completeTask('test-agent', validTestTask.id);
          console.log(`[review-status] Test-agent woken for ${validTestTask.payload.issueId}`);
        } else {
          console.error(`[review-status] Failed to wake test-agent for next task: ${wakeResult.error}`);
        }
      } else {
        console.log(`[review-status] No valid items remaining in test-agent queue`);
      }
    }
  }

  res.json(status);
});

// Specialist completion endpoint
// Allows specialists to signal completion via curl without needing `pan` CLI in PATH
// Usage: curl -X POST http://localhost:3011/api/specialists/done \
//   -H "Content-Type: application/json" \
//   -d '{"specialist":"merge","issueId":"PAN-81","status":"passed","notes":"..."}'
app.post('/api/specialists/done', async (req, res) => {
  const { specialist, issueId, status, notes } = req.body;

  // Validate specialist type
  const validSpecialists = ['review', 'test', 'merge'];
  if (!validSpecialists.includes(specialist)) {
    return res.status(400).json({
      error: `Invalid specialist: ${specialist}. Valid: ${validSpecialists.join(', ')}`,
    });
  }

  // Validate status
  if (!status || !['passed', 'failed'].includes(status)) {
    return res.status(400).json({
      error: `Invalid status: ${status}. Must be 'passed' or 'failed'`,
    });
  }

  // Validate issueId
  if (!issueId) {
    return res.status(400).json({ error: 'issueId is required' });
  }

  const normalizedIssueId = issueId.toUpperCase();
  console.log(`[specialists/done] ${specialist} signaling ${status} for ${normalizedIssueId}`);

  // Build the update based on specialist type
  const update: Partial<ReviewStatus> = {};

  switch (specialist) {
    case 'review':
      update.reviewStatus = status === 'passed' ? 'passed' : 'blocked';
      if (notes) update.reviewNotes = notes;
      break;

    case 'test':
      update.testStatus = status;
      if (notes) update.testNotes = notes;
      break;

    case 'merge':
      update.mergeStatus = status === 'passed' ? 'merged' : 'failed';
      break;
  }

  // Apply the update (this triggers all the side effects like idle state, queue processing)
  const updatedStatus = setReviewStatus(normalizedIssueId, update);

  // Set specialist state to idle
  const { getTmuxSessionName, checkSpecialistQueue, completeSpecialistTask } = await import('../../lib/cloister/specialists.js');
  const tmuxSession = getTmuxSessionName(`${specialist}-agent` as any);
  saveAgentRuntimeState(tmuxSession, {
    state: 'idle',
    lastActivity: new Date().toISOString(),
  });
  console.log(`[specialists/done] Set ${specialist}-agent to idle`);

  // Clear this issue from the specialist's queue
  const queue = checkSpecialistQueue(`${specialist}-agent` as any);
  for (const item of queue.items) {
    if (item.payload?.issueId?.toLowerCase() === normalizedIssueId.toLowerCase()) {
      completeSpecialistTask(`${specialist}-agent` as any, item.id);
      console.log(`[specialists/done] Cleared ${normalizedIssueId} from ${specialist}-agent queue`);
    }
  }

  // Note: readyForMerge is automatically set to false when mergeStatus='merged' in setReviewStatus()

  res.json({
    success: true,
    specialist,
    issueId: normalizedIssueId,
    status,
    notes,
    currentStatus: updatedStatus,
  });
});

// Start review pipeline: triggers review-agent → test-agent
// Does NOT merge - just reviews and tests
app.post('/api/workspaces/:issueId/review', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  // Check workspace exists (local or remote)
  const workspaceInfo = getWorkspaceInfoForIssue(issueId);
  const workspacePath = workspaceInfo.isRemote
    ? workspaceInfo.remotePath!
    : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

  // Check if issue was already reviewed with feedback that needs addressing
  const existingStatus = getReviewStatus(issueId);
  if (existingStatus?.reviewNotes && ['blocked', 'failed'].includes(existingStatus.reviewStatus)) {
    // Issue has existing review feedback - don't reset to reviewing
    // Return info about existing review so user knows to address feedback first
    return res.json({
      success: false,
      alreadyReviewed: true,
      message: `Review already completed with status: ${existingStatus.reviewStatus}`,
      reviewNotes: existingStatus.reviewNotes,
      hint: 'Address the review feedback before requesting another review',
    });
  }

  // Skip issues that already passed review (prevents re-reviewing stale completion markers)
  if (existingStatus?.reviewStatus === 'passed') {
    console.log(`[review] Skipping ${issueId}: already passed review`);
    return res.json({
      success: false,
      alreadyReviewed: true,
      message: `Review already passed for ${issueId}`,
      hint: 'Issue already passed review — proceed to testing or merge',
    });
  }

  // Skip issues that are already merged
  if (existingStatus?.mergeStatus === 'merged') {
    console.log(`[review] Skipping ${issueId}: already merged`);
    return res.json({
      success: false,
      alreadyMerged: true,
      message: `${issueId} is already merged`,
    });
  }

  // Mark review as starting (human-initiated: reset autoRequeueCount)
  setPendingOperation(issueId, 'review');
  setReviewStatus(issueId, { reviewStatus: 'reviewing', testStatus: 'pending', autoRequeueCount: 0 });

  try {
    // 1. Check workspace exists (local or remote)
    if (!workspaceInfo.exists) {
      completePendingOperation(issueId, 'Workspace does not exist');
      setReviewStatus(issueId, { reviewStatus: 'failed', reviewNotes: 'Workspace does not exist' });
      return res.status(400).json({ error: 'Workspace does not exist' });
    }

    // 1b. Update Linear issue to "In Review" status
    const linearApiKey = process.env.LINEAR_API_KEY;
    if (linearApiKey && !issueId.toUpperCase().startsWith('PAN-')) {
      try {
        const getIssueQuery = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              state { id name type }
              team { states { nodes { id name type } } }
            }
          }
        `;
        const issueResponse = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': linearApiKey },
          body: JSON.stringify({ query: getIssueQuery, variables: { id: issueId } }),
        });
        const issueJson = await issueResponse.json();
        const states = issueJson.data?.issue?.team?.states?.nodes || [];
        const linearId = issueJson.data?.issue?.id;
        const inReviewState = states.find((s: any) => s.name.toLowerCase() === 'in review' || s.name.toLowerCase() === 'review');

        if (linearId && inReviewState) {
          const updateMutation = `
            mutation UpdateIssue($id: String!, $stateId: String!) {
              issueUpdate(id: $id, input: { stateId: $stateId }) { success }
            }
          `;
          await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': linearApiKey },
            body: JSON.stringify({ query: updateMutation, variables: { id: linearId, stateId: inReviewState.id } }),
          });
          console.log(`[review] Updated ${issueId} to In Review in Linear`);
        }
      } catch (linearError) {
        console.error('[review] Error updating Linear to In Review:', linearError);
        // Non-fatal - continue with review
      }
    }

    // 2. Push the feature branch to remote first
    try {
      if (workspaceInfo.isRemote && workspaceInfo.vmName) {
        // Push from remote VM via SSH
        await execAsync(
          `ssh -A ${workspaceInfo.vmName}.exe.xyz "cd ${workspacePath} && git push origin ${branchName} 2>&1 || true"`,
          { encoding: 'utf-8', timeout: 30000 }
        );
        console.log(`Pushed ${branchName} to remote (via SSH to ${workspaceInfo.vmName})`);
      } else {
        await execAsync(`git push origin ${branchName}`, { cwd: workspacePath, encoding: 'utf-8' });
        console.log(`Pushed ${branchName} to remote`);
      }
    } catch (pushErr: any) {
      console.log(`Feature branch push note: ${pushErr.message}`);
    }

    // 3. Start the review pipeline (review-agent → test-agent)
    // PAN-88: Check if review-agent is busy BEFORE waking
    const { wakeSpecialist, isRunning, getTmuxSessionName, submitToSpecialistQueue } = await import('../../lib/cloister/specialists.js');
    const { getAgentRuntimeState, saveAgentRuntimeState } = await import('../../lib/agents.js');

    const reviewSession = getTmuxSessionName('review-agent');
    const reviewRunning = await isRunning('review-agent');
    const reviewState = getAgentRuntimeState(reviewSession);
    const reviewIdle = reviewState?.state === 'idle' || reviewState?.state === 'suspended' || !reviewRunning;

    // Build workspace access instructions based on local vs remote
    const isRemoteWorkspace = workspaceInfo.isRemote && workspaceInfo.vmName;
    const sshPrefix = isRemoteWorkspace ? `ssh -A ${workspaceInfo.vmName}.exe.xyz "` : '';
    const sshSuffix = isRemoteWorkspace ? '"' : '';
    const cdPrefix = isRemoteWorkspace ? `cd ${workspacePath} && ` : '';
    const workspaceAccessInstructions = isRemoteWorkspace
      ? `**REMOTE WORKSPACE** - SSH to access:\n   ssh -A ${workspaceInfo.vmName}.exe.xyz\n   cd ${workspacePath}`
      : `cd ${workspacePath}`;

    // If review-agent is busy, queue this task instead
    if (!reviewIdle) {
      console.log(`[review] review-agent busy, queuing ${issueId}`);
      submitToSpecialistQueue('review-agent', {
        priority: 'normal',
        source: 'review-endpoint',
        issueId,
        workspace: workspacePath,
        branch: branchName,
        isRemote: workspaceInfo.isRemote,
        vmName: workspaceInfo.vmName,
      });
      completePendingOperation(issueId, null);
      return res.json({
        success: true,
        queued: true,
        message: `Review queued for ${issueId} - review-agent is busy`,
        isRemote: workspaceInfo.isRemote,
      });
    }

    // Set state to active IMMEDIATELY to prevent concurrent wakes (PAN-88)
    saveAgentRuntimeState(reviewSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });
    console.log(`[review] Marked review-agent active, starting pipeline for ${issueId}${isRemoteWorkspace ? ' (remote)' : ''}...`);

    const reviewPrompt = `STRICT REVIEW for ${issueId}

You are a DEMANDING code reviewer. Find EVERY issue before code can proceed to testing.
DO NOT BE NICE. BE THOROUGH.

=== CONTEXT ===
ISSUE: ${issueId}
WORKSPACE: ${workspacePath}${isRemoteWorkspace ? ` (REMOTE on ${workspaceInfo.vmName})` : ''}
BRANCH: ${branchName}
PROJECT: ${projectPath}
${isRemoteWorkspace ? `REMOTE VM: ${workspaceInfo.vmName}.exe.xyz` : ''}

=== WORKSPACE ACCESS ===
${workspaceAccessInstructions}

=== MANDATORY REQUIREMENTS (Block if ANY violated) ===
1. **Tests Required** - Every new function MUST have test files. No exceptions.
2. **No In-Memory Only Storage** - Important data MUST persist to files/DB.
3. **No Dead Code** - Remove unused imports, functions, variables.
4. **Error Handling** - All async operations must handle errors.
5. **Type Safety** - No \`any\` without justification.

=== YOUR TASK ===
1. ${workspaceAccessInstructions}
2. Review ALL changes: ${sshPrefix}${cdPrefix}git diff main...${branchName}${sshSuffix}
3. Check EVERY file for issues
4. List EVERY issue found with file:line references

**IMPORTANT: DO NOT run tests (npm test). You are the REVIEW agent - you only review code.**
**The TEST agent will run tests in the next step. Just verify test FILES exist.**

=== WHEN DONE ===
**IF ANY ISSUES FOUND:**
- Update status: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"blocked","reviewNotes":"[list issues]"}'
- Use /send-feedback-to-agent to notify agent-${issueLower}
- DO NOT hand off to test-agent

**IF CODE IS PERFECT:**
- Update status: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"passed"}'
- Queue test-agent (DO NOT use pan specialists wake directly):

curl -X POST http://localhost:3011/api/specialists/test-agent/queue -H "Content-Type: application/json" -d '{"issueId":"${issueId}","workspace":"${workspacePath}","branch":"${branchName}","isRemote":${workspaceInfo.isRemote},"vmName":"${workspaceInfo.vmName || ''}","customPrompt":"TEST for ${issueId}:\\nWORKSPACE: ${workspacePath}${isRemoteWorkspace ? ` (REMOTE on ${workspaceInfo.vmName})` : ''}\\nBRANCH: ${branchName}\\n\\n1. ${isRemoteWorkspace ? `SSH: ssh -A ${workspaceInfo.vmName}.exe.xyz then cd ${workspacePath}` : `cd ${workspacePath}`}\\n2. Run tests: npm test\\n3. Update status:\\n   - PASS: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H Content-Type:application/json -d {testStatus:passed}\\n   - FAIL: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -d {testStatus:failed,testNotes:[details]}\\n\\nIMPORTANT: Do NOT hand off to merge-agent. Just update status. Human will click Merge."}'`;

    const reviewResult = await wakeSpecialist('review-agent', reviewPrompt, {
      waitForReady: true,
      startIfNotRunning: true,
    });

    if (!reviewResult.success) {
      console.warn(`[review] review-agent failed to wake: ${reviewResult.message}`);
      completePendingOperation(issueId, `Failed to start review: ${reviewResult.message}`);
      setReviewStatus(issueId, { reviewStatus: 'failed', reviewNotes: reviewResult.message });
      return res.status(500).json({ error: `Failed to start review: ${reviewResult.message}` });
    }

    console.log(`[review] Review pipeline started for ${issueId}`);
    completePendingOperation(issueId, null);

    return res.json({
      success: true,
      message: `Review started for ${issueId}`,
      pipeline: 'review → test',
      note: 'Watch the specialists panel for progress. MERGE button will appear when review+test pass.',
    });

  } catch (error: any) {
    console.error(`[review] Error starting review:`, error);
    completePendingOperation(issueId, error.message);
    setReviewStatus(issueId, { reviewStatus: 'failed', reviewNotes: error.message });
    return res.status(500).json({ error: error.message });
  }
});

// Agent-initiated re-review request with circuit breaker (PAN-90)
// Allows agents to request re-review after fixing feedback, max 3 times
const MAX_AUTO_REQUEUE = 3;

app.post('/api/workspaces/:issueId/request-review', async (req, res) => {
  const { issueId } = req.params;
  const { message } = req.body; // Optional message for reviewers

  const existingStatus = getReviewStatus(issueId);
  const currentCount = existingStatus?.autoRequeueCount || 0;

  // Circuit breaker: max 3 auto-requeues
  if (currentCount >= MAX_AUTO_REQUEUE) {
    console.log(`[request-review] Circuit breaker: ${issueId} exceeded max auto-requeues (${currentCount}/${MAX_AUTO_REQUEUE})`);
    return res.status(429).json({
      success: false,
      error: 'Circuit breaker triggered',
      message: `Maximum automatic re-review requests (${MAX_AUTO_REQUEUE}) exceeded. Human intervention required.`,
      autoRequeueCount: currentCount,
      hint: 'A human must click the Review button to continue.',
    });
  }

  // Check if workspace exists (local or remote)
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  const workspaceInfo = getWorkspaceInfoForIssue(issueId);
  const workspacePath = workspaceInfo.isRemote
    ? workspaceInfo.remotePath!
    : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

  if (!workspaceInfo.exists) {
    return res.status(400).json({
      success: false,
      error: 'Workspace does not exist',
    });
  }

  // Increment counter and queue for review
  const newCount = currentCount + 1;
  const reviewNotes = message ? `Agent re-review request (${newCount}/${MAX_AUTO_REQUEUE}): ${message}` : undefined;

  setReviewStatus(issueId, {
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    autoRequeueCount: newCount,
    reviewNotes,
  });

  console.log(`[request-review] Agent requested re-review for ${issueId} (${newCount}/${MAX_AUTO_REQUEUE})${workspaceInfo.isRemote ? ` (remote: ${workspaceInfo.vmName})` : ''}`);

  // Queue for review-agent (same logic as human-initiated review)
  try {
    const { wakeSpecialistOrQueue } = await import('../../lib/cloister/specialists.js');

    const result = await wakeSpecialistOrQueue('review-agent', {
      issueId,
      workspace: workspacePath,
      branch: branchName,
      isRemote: workspaceInfo.isRemote,
      vmName: workspaceInfo.vmName,
    }, {
      priority: 'normal',
      source: 'agent-request',
    });

    if (result.success) {
      console.log(`[request-review] Queued ${issueId} for review-agent`);
      return res.json({
        success: true,
        queued: result.queued,
        message: result.queued
          ? `Review queued (${newCount}/${MAX_AUTO_REQUEUE} auto-requeues used)`
          : `Review started (${newCount}/${MAX_AUTO_REQUEUE} auto-requeues used)`,
        autoRequeueCount: newCount,
        remainingRequeues: MAX_AUTO_REQUEUE - newCount,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to queue review',
        autoRequeueCount: newCount,
      });
    }
  } catch (error: any) {
    console.error(`[request-review] Error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message,
      autoRequeueCount: newCount,
    });
  }
});

// Merge workspace: ONLY merges (requires review+test to have passed first)
// SAFETY: Never delete remote branches. Always push before cleanup. Abort on any error.
app.post('/api/workspaces/:issueId/merge', async (req, res) => {
  const { issueId } = req.params;

  // Check review status - must be ready for merge
  const reviewStatus = getReviewStatus(issueId);
  if (!reviewStatus?.readyForMerge) {
    return res.status(400).json({
      error: 'Cannot merge: review and tests have not passed yet',
      reviewStatus: reviewStatus?.reviewStatus || 'pending',
      testStatus: reviewStatus?.testStatus || 'pending',
    });
  }

  // Check if already merging
  if (reviewStatus?.mergeStatus === 'merging') {
    return res.status(400).json({
      error: 'Merge already in progress',
      mergeStatus: 'merging',
    });
  }

  // Check if already merged
  if (reviewStatus?.mergeStatus === 'merged') {
    return res.status(400).json({
      error: 'Already merged',
      mergeStatus: 'merged',
    });
  }

  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const branchName = `feature/${issueLower}`;

  // Check if this is a remote workspace
  const workspaceInfo = getWorkspaceInfoForIssue(issueId);

  // Mark merge as in progress
  setReviewStatus(issueId, { mergeStatus: 'merging' });

  // Mark operation as pending
  setPendingOperation(issueId, 'merge');

  // REMOTE WORKSPACE: Merge via GitHub PR
  if (workspaceInfo.isRemote && workspaceInfo.vmName) {
    console.log(`[merge] Remote workspace detected for ${issueId}, using GitHub PR merge...`);

    try {
      // Ensure PR exists
      const prResult = await ensurePRExists(issueId);
      if (!prResult.prUrl) {
        const error = `Failed to create PR: ${prResult.error || 'Unknown error'}`;
        setReviewStatus(issueId, { mergeStatus: 'failed' });
        completePendingOperation(issueId, error);
        return res.status(400).json({ error });
      }

      // Extract PR number from URL
      const prMatch = prResult.prUrl.match(/\/pull\/(\d+)/);
      if (!prMatch) {
        const error = `Could not parse PR number from URL: ${prResult.prUrl}`;
        setReviewStatus(issueId, { mergeStatus: 'failed' });
        completePendingOperation(issueId, error);
        return res.status(400).json({ error });
      }
      const prNumber = prMatch[1];

      // Merge the PR via GitHub CLI (squash merge, do NOT delete branch)
      console.log(`[merge] Merging PR #${prNumber} for ${issueId}...`);
      const { stdout: mergeOutput } = await execAsync(
        `gh pr merge ${prNumber} --repo eltmon/panopticon-cli --squash`,
        { encoding: 'utf-8' }
      );
      console.log(`[merge] PR merge output: ${mergeOutput}`);

      // Mark as merged
      setReviewStatus(issueId, { mergeStatus: 'merged', readyForMerge: false });
      clearReviewStatus(issueId);
      completePendingOperation(issueId, null);

      // Close the issue
      await closeIssueAfterMerge(issueId);

      return res.json({
        success: true,
        message: `Successfully merged PR #${prNumber} for ${issueId}`,
        prUrl: prResult.prUrl,
        remote: true,
      });
    } catch (error: any) {
      console.error(`[merge] Remote merge failed for ${issueId}:`, error);
      setReviewStatus(issueId, { mergeStatus: 'failed' });
      completePendingOperation(issueId, error.message);
      return res.status(500).json({
        error: `Remote merge failed: ${error.message}`,
      });
    }
  }

  // LOCAL WORKSPACE: Use merge-agent for local git merge
  try {
    // 1. Check workspace exists
    if (!existsSync(workspacePath)) {
      completePendingOperation(issueId, 'Workspace does not exist');
      return res.status(400).json({ error: 'Workspace does not exist' });
    }

    // 2. Push the feature branch to remote BEFORE merging (preserve work)
    try {
      await execAsync(`git push origin ${branchName}`, { cwd: workspacePath, encoding: 'utf-8' });
      console.log(`Pushed ${branchName} to remote`);
    } catch (pushErr: any) {
      console.log(`Feature branch push note: ${pushErr.message}`);
    }

    // 3. Spawn merge-agent to handle the merge
    const { spawnMergeAgentForBranches } = await import('../../lib/cloister/merge-agent.js');

    console.log(`[merge] Starting merge-agent for ${issueId}...`);

    const mergeResult = await spawnMergeAgentForBranches(
      projectPath,
      branchName,
      'main',
      issueId
    );

    if (mergeResult.success && mergeResult.testsStatus === 'PASS') {
      console.log(`[merge] Successfully merged ${issueId}`);
      clearReviewStatus(issueId); // Clear review status after successful merge
      completePendingOperation(issueId, null);

      // Close the issue after successful merge
      await closeIssueAfterMerge(issueId);

      return res.json({
        success: true,
        message: `Successfully merged ${issueId} to main and closed issue`,
        testsStatus: 'PASS',
      });
    } else if (mergeResult.success) {
      console.log(`[merge] Merged ${issueId} (tests: ${mergeResult.testsStatus})`);
      clearReviewStatus(issueId);
      completePendingOperation(issueId, null);

      // Close the issue after successful merge (even if tests skipped)
      await closeIssueAfterMerge(issueId);

      return res.json({
        success: true,
        message: `Merged ${issueId} to main and closed issue`,
        testsStatus: mergeResult.testsStatus,
        note: mergeResult.testsStatus === 'SKIP' ? 'Tests were skipped' : undefined,
      });
    } else {
      const error = mergeResult.notes || 'Merge failed';
      setReviewStatus(issueId, { mergeStatus: 'failed' });
      completePendingOperation(issueId, error);
      return res.status(500).json({ error, mergeResult });
    }

  } catch (error: any) {
    console.error(`[merge] Error:`, error);
    setReviewStatus(issueId, { mergeStatus: 'failed' });
    completePendingOperation(issueId, error.message);
    return res.status(500).json({ error: error.message });
  }
});

// DEPRECATED: Old approve endpoint - redirects to review flow
// TODO: Remove after frontend is updated
app.post('/api/workspaces/:issueId/approve', async (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const branchName = `feature/${issueLower}`;

  // Track what we've done for rollback info
  let mergeCompleted = false;
  let pushCompleted = false;

  // Mark operation as pending (persists across refreshes)
  setPendingOperation(issueId, 'approve');

  try {
    // 1. Check workspace exists
    if (!existsSync(workspacePath)) {
      completePendingOperation(issueId, 'Workspace does not exist');
      return res.status(400).json({ error: 'Workspace does not exist' });
    }

    // 2. Verify the feature branch exists
    try {
      await execAsync(`git rev-parse --verify ${branchName}`, { cwd: projectPath, encoding: 'utf-8' });
    } catch {
      completePendingOperation(issueId, `Branch ${branchName} does not exist`);
      return res.status(400).json({ error: `Branch ${branchName} does not exist` });
    }

    // 3. Check for uncommitted changes in workspace before proceeding
    // Use -uno to ignore untracked files - they don't block merges and are often
    // Panopticon-managed symlinks that haven't been added to .gitignore yet
    try {
      const { stdout: status } = await execAsync('git status --porcelain -uno', { cwd: workspacePath, encoding: 'utf-8' });
      if (status.trim()) {
        const error = `Workspace has uncommitted changes. Please commit or stash them first:\ncd ${workspacePath}\ngit status`;
        completePendingOperation(issueId, error);
        return res.status(400).json({ error });
      }
    } catch (statusErr) {
      // If we can't check status, continue but log it
      console.warn('Could not check workspace status:', statusErr);
    }

    // 4. Push the feature branch to remote BEFORE merging (preserve work)
    try {
      await execAsync(`git push origin ${branchName}`, { cwd: workspacePath, encoding: 'utf-8' });
      console.log(`Pushed ${branchName} to remote`);
    } catch (pushErr: any) {
      // If push fails, it might already be up to date - that's okay
      console.log(`Feature branch push note: ${pushErr.message}`);
    }

    // 5. Switch to main and pull latest
    try {
      await execAsync('git checkout main', { cwd: projectPath, encoding: 'utf-8' });
      // Use explicit origin main to avoid tracking branch issues in worktrees
      await execAsync('git pull origin main --ff-only', { cwd: projectPath, encoding: 'utf-8' });
    } catch (checkoutErr: any) {
      const error = `Failed to checkout/update main branch: ${checkoutErr.message}`;
      completePendingOperation(issueId, error);
      return res.status(400).json({ error });
    }

    // 6. SPECIALIST WORKFLOW: review-agent → test-agent → merge-agent
    // Kick off review-agent with handoff instructions - it will wake the next specialists
    const { wakeSpecialist } = await import('../../lib/cloister/specialists.js');

    // Build the full pipeline prompt for review-agent
    // It will hand off to test-agent, which hands off to merge-agent
    console.log(`[approve] Starting specialist pipeline for ${issueId}...`);

    const pipelinePrompt = `STRICT REVIEW WORKFLOW for ${issueId}

You are a DEMANDING code reviewer. Your job is to find EVERY issue before code can proceed.
DO NOT BE NICE. BE THOROUGH. The code must be PERFECT before it can proceed to testing.

=== CONTEXT ===
ISSUE: ${issueId}
WORKSPACE: ${workspacePath}
BRANCH: ${branchName}
PROJECT: ${projectPath}

=== MANDATORY REQUIREMENTS (Block if ANY violated) ===
1. **Tests Required** - Every new function MUST have test files. No exceptions.
2. **No In-Memory Only Storage** - Important data MUST persist to files/DB.
3. **No Dead Code** - Remove unused imports, functions, variables.
4. **Error Handling** - All async operations must handle errors.
5. **Type Safety** - No \`any\` without justification.

=== YOUR TASK (EXHAUSTIVE REVIEW) ===
1. cd ${workspacePath}
2. Review ALL changes: git diff main...${branchName}
3. Check EVERY file for:
   - Missing test FILES (AUTOMATIC REJECTION)
   - In-memory storage for persistent data (AUTOMATIC REJECTION)
   - Security vulnerabilities
   - Performance issues
   - Code quality problems
4. List EVERY issue found with file:line references

**IMPORTANT: DO NOT run tests (npm test). You are the REVIEW agent - you only review code.**
**The TEST agent will run tests in the next step. Just verify test FILES exist.**

=== DECISION ===
**IF ANY ISSUES FOUND:**
- Update status: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"blocked","reviewNotes":"[detailed list of all issues found]"}'
- Use /send-feedback-to-agent to send detailed feedback to agent-${issueId.toLowerCase()}
- DO NOT hand off to test-agent

**ONLY IF CODE IS PERFECT (rare):**
- Update status: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H "Content-Type: application/json" -d '{"reviewStatus":"passed"}'
- Queue test-agent (DO NOT use pan specialists wake directly):

curl -X POST http://localhost:3011/api/specialists/test-agent/queue -H "Content-Type: application/json" -d '{"issueId":"${issueId}","workspace":"${workspacePath}","branch":"${branchName}","customPrompt":"TEST TASK for ${issueId}:\\nWORKSPACE: ${workspacePath}\\nBRANCH: ${branchName}\\n\\n1. cd ${workspacePath}\\n2. Run tests: npm test\\n3. Update status via API:\\n   - PASS: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -H Content-Type:application/json -d {testStatus:passed}\\n   - FAIL: curl -X POST http://localhost:3011/api/workspaces/${issueId}/review-status -d {testStatus:failed,testNotes:[details]}\\n\\nIMPORTANT: Do NOT hand off to merge-agent. Human clicks Merge button when ready."}'

=== REVIEW PHILOSOPHY ===
- Your default answer is BLOCK, not PASS
- Missing tests alone is enough to reject
- In-memory storage for important data is enough to reject
- "It works" is NOT enough - code must be EXCELLENT
- Find EVERYTHING. The agent should learn from your feedback.`;

    const reviewResult = await wakeSpecialist('review-agent', pipelinePrompt, {
      waitForReady: true,
      startIfNotRunning: true,
    });

    if (!reviewResult.success) {
      console.warn(`[approve] review-agent failed to wake: ${reviewResult.message}`);
      // Fall back to direct merge if specialists aren't available
      console.log(`[approve] Falling back to direct merge...`);
    } else {
      console.log(`[approve] Pipeline started - review-agent will queue test-agent when done`);
      // Don't wait - the specialists will handle the rest
      // Human clicks Merge button when review+test pass

      // Return early with pipeline status
      completePendingOperation(issueId, null);
      return res.json({
        success: true,
        message: `Approval pipeline started for ${issueId}. Specialists: review → test`,
        pipeline: 'running',
        note: 'Watch the specialists panel for progress. Click Merge when review+test pass.',
      });
    }

    // 6c. MERGE-AGENT: Direct merge (fallback if review-agent failed)
    console.log(`[approve] Step 3/3: Waking merge-agent for ${issueId}...`);

    try {
      const mergeResult = await spawnMergeAgentForBranches(
        projectPath,
        branchName,
        'main',
        issueId
      );

      if (mergeResult.success && mergeResult.testsStatus === 'PASS') {
        // merge-agent successfully completed merge and tests passed
        mergeCompleted = true;
        console.log(`merge-agent successfully merged ${issueId}`);
        if (mergeResult.resolvedFiles?.length) {
          console.log(`Resolved conflicts in: ${mergeResult.resolvedFiles.join(', ')}`);
        }
      } else if (mergeResult.success && mergeResult.testsStatus === 'SKIP') {
        // merge-agent completed merge but tests were skipped
        mergeCompleted = true;
        console.log(`merge-agent merged ${issueId} (tests skipped)`);
        if (mergeResult.resolvedFiles?.length) {
          console.log(`Resolved conflicts in: ${mergeResult.resolvedFiles.join(', ')}`);
        }
      } else if (mergeResult.success && mergeResult.testsStatus === 'FAIL') {
        // merge-agent completed merge but tests failed
        try {
          await execAsync('git reset --hard HEAD~1', { cwd: projectPath, encoding: 'utf-8' });
        } catch {}
        const error = `merge-agent completed merge but tests failed.\nReason: ${mergeResult.reason || 'Tests did not pass'}\n\nPlease fix tests and try again.`;
        completePendingOperation(issueId, error);
        return res.status(400).json({ error });
      } else {
        // merge-agent failed (conflicts it couldn't resolve, or other issue)
        try {
          await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' });
        } catch {}
        try {
          await execAsync('git reset --hard HEAD', { cwd: projectPath, encoding: 'utf-8' });
        } catch {}
        const error = `merge-agent could not complete merge.\nReason: ${mergeResult.reason || 'Unknown'}\nFailed files: ${mergeResult.failedFiles?.join(', ') || 'N/A'}\n\nPlease resolve manually:\ncd ${projectPath}\ngit merge ${branchName}`;
        completePendingOperation(issueId, error);
        return res.status(400).json({ error });
      }
    } catch (agentError: any) {
      // merge-agent itself failed (timeout, crash, etc.)
      try {
        await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' });
      } catch {}
      try {
        await execAsync('git reset --hard HEAD', { cwd: projectPath, encoding: 'utf-8' });
      } catch {}
      const error = `merge-agent failed to run: ${agentError.message}\n\nPlease resolve manually:\ncd ${projectPath}\ngit merge ${branchName}`;
      completePendingOperation(issueId, error);
      return res.status(400).json({ error });
    }

    // 7. CRITICAL: Push merged main to remote BEFORE any cleanup
    try {
      await execAsync('git push origin main', { cwd: projectPath, encoding: 'utf-8' });
      pushCompleted = true;
      console.log('Pushed merged main to remote');
    } catch (pushErr: any) {
      // CRITICAL: If push fails, DO NOT proceed with cleanup
      const error = `Merge succeeded but push failed! Your work is safe locally.\nPlease push manually: cd ${projectPath} && git push origin main\nError: ${pushErr.message}`;
      completePendingOperation(issueId, error);
      return res.status(400).json({ error });
    }

    // 8. Stop any running agent
    const agentId = `agent-${issueLower}`;
    try {
      await execAsync(`tmux has-session -t ${agentId} 2>/dev/null && tmux kill-session -t ${agentId}`, {
        encoding: 'utf-8',
        shell: '/bin/bash'
      });
      console.log(`Stopped agent ${agentId}`);
    } catch {
      // Agent not running, that's fine
    }

    // 8.5. Move PRD from active to completed (preserve documentation)
    try {
      const activePrdPath = join(projectPath, 'docs', 'prds', 'active', `${issueLower}-plan.md`);
      const completedDir = join(projectPath, 'docs', 'prds', 'completed');
      const completedPrdPath = join(completedDir, `${issueLower}-plan.md`);

      if (existsSync(activePrdPath)) {
        // Ensure completed directory exists
        if (!existsSync(completedDir)) {
          mkdirSync(completedDir, { recursive: true });
        }
        // Move the PRD
        renameSync(activePrdPath, completedPrdPath);
        console.log(`Moved PRD from active to completed: ${issueLower}-plan.md`);

        // Commit the PRD move
        try {
          await execAsync(`git add docs/prds && git commit -m "docs: move ${issueId} PRD to completed"`, {
            cwd: projectPath,
            encoding: 'utf-8'
          });
          await execAsync('git push origin main', { cwd: projectPath, encoding: 'utf-8' });
          console.log('Committed and pushed PRD move');
        } catch (commitErr: any) {
          // Non-fatal - PRD move is nice to have
          console.log('Could not commit PRD move (non-fatal):', commitErr.message);
        }
      }
    } catch (prdErr: any) {
      // Non-fatal - PRD handling shouldn't block approval
      console.log('PRD move failed (non-fatal):', prdErr.message);
    }

    // 9. Remove the workspace (git worktree) - ONLY after successful push
    try {
      await execAsync(`git worktree remove workspaces/feature-${issueLower} --force`, {
        cwd: projectPath,
        encoding: 'utf-8'
      });
      console.log(`Removed workspace for ${issueId}`);
    } catch (wtError: any) {
      // Log but don't fail - workspace cleanup is non-critical after push
      console.error('Error removing worktree (non-fatal):', wtError.message);
    }

    // 10. DISABLED: Keep feature branches for safety during early development
    // TODO: Re-enable branch cleanup once workflow is battle-tested
    // try {
    //   execSync(`git branch -d ${branchName}`, { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    //   console.log(`Deleted local branch ${branchName} (remote preserved)`);
    // } catch (branchError: any) {
    //   console.log(`Could not delete local branch ${branchName} (may have unmerged commits): ${branchError.message}`);
    // }
    console.log(`Keeping local branch ${branchName} for safety (early development mode)`);

    // 6. Update Linear issue to Done (or GitHub label)
    const apiKey = getLinearApiKey();
    const isGitHubIssue = issueId.startsWith('PAN-');

    if (isGitHubIssue) {
      // GitHub issue - add "done" label, remove "in-progress"
      const ghConfig = getGitHubConfig();
      if (ghConfig) {
        const number = parseInt(issueId.split('-')[1], 10);
        const repoConfig = ghConfig.repos.find(r => r.prefix === 'PAN') || ghConfig.repos[0];
        const { owner, repo } = repoConfig;
        const token = ghConfig.token;

        await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/in-progress`, {
          method: 'DELETE',
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
        }).catch(() => {});

        await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
          method: 'POST',
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: ['done'] }),
        });

        // Close the issue
        await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
          method: 'PATCH',
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'closed' }),
        });
      }
    } else if (apiKey) {
      // Linear issue - transition through proper states: In Progress → In Review → Done
      try {
        const getIssueQuery = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              state { id name type }
              team { states { nodes { id name type } } }
            }
          }
        `;
        const issueResponse = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
          body: JSON.stringify({ query: getIssueQuery, variables: { id: issueId } }),
        });
        const issueJson = await issueResponse.json();
        const states = issueJson.data?.issue?.team?.states?.nodes || [];
        const currentState = issueJson.data?.issue?.state;
        const linearId = issueJson.data?.issue?.id;

        // Find the states we need
        const inProgressState = states.find((s: any) => s.type === 'started' || s.name.toLowerCase() === 'in progress');
        const inReviewState = states.find((s: any) => s.name.toLowerCase() === 'in review' || s.name.toLowerCase() === 'review');
        const doneState = states.find((s: any) => s.type === 'completed' || s.name.toLowerCase() === 'done');

        const updateMutation = `
          mutation UpdateIssue($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) { success }
          }
        `;

        if (linearId) {
          // Transition through states properly
          // If still in Planning/Backlog, move to In Progress first
          if (currentState?.type === 'backlog' || currentState?.type === 'unstarted') {
            if (inProgressState) {
              await fetch('https://api.linear.app/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
                body: JSON.stringify({ query: updateMutation, variables: { id: linearId, stateId: inProgressState.id } }),
              });
              console.log(`Updated ${issueId} to In Progress`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay between transitions
            }
          }

          // Move to In Review
          if (inReviewState) {
            await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: updateMutation, variables: { id: linearId, stateId: inReviewState.id } }),
            });
            console.log(`Updated ${issueId} to In Review`);
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay between transitions
          }

          // Finally move to Done
          if (doneState) {
            await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: updateMutation, variables: { id: linearId, stateId: doneState.id } }),
            });
            console.log(`Updated ${issueId} to Done`);
          }
        }
      } catch (linearError) {
        console.error('Error updating Linear:', linearError);
      }
    }

    // For Panopticon issues, run pan sync to distribute new skills/commands/agents
    if (isGitHubIssue || issueId.toUpperCase().startsWith('PAN-')) {
      try {
        console.log('Running pan sync for Panopticon issue...');
        await execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 });
        console.log('pan sync completed');
      } catch (syncError: any) {
        console.error('pan sync failed (non-fatal):', syncError.message);
        // Don't fail the approve - sync failure is non-fatal
      }
    }

    // Record task metrics for the completed work (async to avoid blocking)
    await recordApprovedTask(issueId, workspacePath, 'success');

    // Clear pending operation on success
    completePendingOperation(issueId);

    res.json({
      success: true,
      message: `Approved ${issueId}: merged, workspace removed, issue closed${isGitHubIssue || issueId.toUpperCase().startsWith('PAN-') ? ', skills synced' : ''}, metrics recorded`,
    });
  } catch (error: any) {
    console.error('Error approving workspace:', error);
    completePendingOperation(issueId, error.message);
    res.status(500).json({ error: 'Failed to approve: ' + error.message });
  }
});

// Clear pending operation (dismiss error state)
app.delete('/api/workspaces/:issueId/pending', (req, res) => {
  const { issueId } = req.params;
  clearPendingOperation(issueId);
  res.json({ success: true });
});

// Close/resolve an issue manually (without merge)
app.post('/api/issues/:issueId/close', async (req, res) => {
  const { issueId } = req.params;
  const { reason } = req.body;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const branchName = `feature/${issueLower}`;

  try {
    const isGitHubIssue = issueId.toUpperCase().startsWith('PAN-');
    const apiKey = getLinearApiKey();

    // 1. Close the issue (GitHub via gh CLI, Linear via API)
    if (isGitHubIssue) {
      const ghConfig = getGitHubConfig();
      const number = parseInt(issueId.split('-')[1], 10);
      const repoConfig = ghConfig?.repos.find(r => r.prefix === 'PAN') || ghConfig?.repos[0];
      const repoPath = repoConfig ? `${repoConfig.owner}/${repoConfig.repo}` : 'eltmon/panopticon-cli';

      try {
        // Use gh CLI for better auth handling
        await execAsync(`gh issue close ${number} --repo ${repoPath} --reason completed`, {
          encoding: 'utf-8',
          timeout: 30000,
        });
        console.log(`Closed GitHub issue ${issueId} via gh CLI`);
      } catch (ghError: any) {
        console.error('gh CLI failed, trying API:', ghError.message);
        // Fallback to API if gh fails
        if (ghConfig && repoConfig) {
          await fetch(`https://api.github.com/repos/${repoConfig.owner}/${repoConfig.repo}/issues/${number}`, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${ghConfig.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: 'closed' }),
          });
        }
      }
    } else if (apiKey) {
      // Linear issue - update to Done
      const getIssueQuery = `
        query GetIssue($id: String!) {
          issue(id: $id) {
            id
            team { states { nodes { id name type } } }
          }
        }
      `;
      const issueResponse = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({ query: getIssueQuery, variables: { id: issueId } }),
      });
      const issueJson = await issueResponse.json();
      const states = issueJson.data?.issue?.team?.states?.nodes || [];
      const doneState = states.find((s: any) => s.type === 'completed' || s.name.toLowerCase() === 'done');
      const linearId = issueJson.data?.issue?.id;

      if (doneState && linearId) {
        const updateMutation = `
          mutation UpdateIssue($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) { success }
          }
        `;
        await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
          body: JSON.stringify({ query: updateMutation, variables: { id: linearId, stateId: doneState.id } }),
        });
        console.log(`Updated Linear issue ${issueId} to Done`);
      }
    }

    // 2. Stop any running agent
    const agentId = `agent-${issueLower}`;
    try {
      await execAsync(`tmux has-session -t ${agentId} 2>/dev/null && tmux kill-session -t ${agentId}`, {
        encoding: 'utf-8',
        shell: '/bin/bash'
      });
      console.log(`Stopped agent ${agentId}`);
    } catch {
      // Agent not running, that's fine
    }

    // 3. Clean up workspace if it exists
    if (existsSync(workspacePath)) {
      try {
        await execAsync(`git worktree remove workspaces/feature-${issueLower} --force`, {
          cwd: projectPath,
          encoding: 'utf-8'
        });
        console.log(`Removed workspace for ${issueId}`);
      } catch (wtError: any) {
        console.error('Error removing worktree:', wtError.message);
      }
    }

    // 4. Feature branches are preserved for history - do NOT delete them
    // Users can manually delete branches if needed via: git branch -d <branch>

    // 5. Run pan sync for Panopticon issues
    if (isGitHubIssue) {
      try {
        await execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 });
        console.log('pan sync completed');
      } catch {}
    }

    res.json({
      success: true,
      message: `Closed ${issueId}${reason ? ': ' + reason : ''}`,
    });

    // Invalidate cache for affected tracker
    if (isGitHubIssue) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }
  } catch (error: any) {
    console.error('Error closing issue:', error);
    res.status(500).json({ error: 'Failed to close: ' + error.message });
  }
});

// Start agent for issue
app.post('/api/agents', async (req, res) => {
  const { issueId, projectId } = req.body;

  if (!issueId) {
    return res.status(400).json({ error: 'issueId required' });
  }

  const issueLower = issueId.toLowerCase();

  // Check if this is a remote workspace
  const { loadWorkspaceMetadata } = await import('../../lib/remote/workspace-metadata.js');
  const workspaceMetadata = loadWorkspaceMetadata(issueId);
  const isRemote = workspaceMetadata?.location === 'remote';

  // SAFEGUARD: Check if planning agent is still running
  // Never start work agent while planning agent is active - they'll conflict
  const planningSession = `planning-${issueLower}`;
  try {
    let planningStillRunning = false;

    if (isRemote && workspaceMetadata?.vmName) {
      // Check on remote VM
      const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
      const exe = createExeProvider({ infraVm: workspaceMetadata.infraVm });
      const result = await exe.ssh(workspaceMetadata.vmName, `tmux list-sessions -F '#{session_name}' 2>/dev/null || true`);
      planningStillRunning = result.stdout.split('\n').includes(planningSession);
    } else {
      // Check locally
      const { stdout: sessions } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
      planningStillRunning = sessions.split('\n').includes(planningSession);
    }

    if (planningStillRunning) {
      console.warn(`[start-agent] BLOCKED: Planning agent still running for ${issueId}${isRemote ? ' (remote)' : ''}`);
      return res.status(409).json({
        error: `Planning agent is still running for ${issueId}. Kill the planning session first or wait for it to complete.`,
        planningSession,
        hint: 'Use "Complete Planning" or "Abort Planning" to end the planning session before starting work.',
      });
    }
  } catch (tmuxErr) {
    // If tmux check fails, log but continue (fail-open)
    console.warn(`[start-agent] Could not check for planning session: ${tmuxErr}`);
  }

  // Mark planning agent state as stopped since we're transitioning to work agent
  const planningStateFile = join(homedir(), '.panopticon', 'agents', planningSession, 'state.json');
  if (existsSync(planningStateFile)) {
    try {
      const planningState = JSON.parse(readFileSync(planningStateFile, 'utf-8'));
      planningState.status = 'stopped';
      planningState.stoppedAt = new Date().toISOString();
      planningState.stoppedReason = 'work-agent-started';
      writeFileSync(planningStateFile, JSON.stringify(planningState, null, 2));
      console.log(`[start-agent] Marked planning agent ${planningSession} as stopped`);
    } catch (stateErr) {
      console.warn(`[start-agent] Could not update planning state: ${stateErr}`);
    }
  }

  try {
    // Extract prefix from issue ID (e.g., "MIN" from "MIN-645")
    const issuePrefix = issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);

    // Before starting agent, commit and push any planning artifacts
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const workspacePlanningDir = join(workspacePath, '.planning');
    const legacyPlanningDir = join(projectPath, '.planning', issueLower);

    let planningDir: string | null = null;
    if (existsSync(workspacePlanningDir)) {
      planningDir = workspacePlanningDir;
    } else if (existsSync(legacyPlanningDir)) {
      planningDir = legacyPlanningDir;
    }

    if (planningDir) {
      try {
        // Get the git root (workspace or project root)
        const gitRoot = planningDir.includes('/workspaces/')
          ? workspacePath
          : projectPath;

        // Git add planning and beads directories
        await execAsync(`git add .planning/`, { cwd: gitRoot, encoding: 'utf-8' });
        // Also add .beads/ if it exists
        if (existsSync(join(gitRoot, '.beads'))) {
          await execAsync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' });
        }
        // Also add STATE.md and WORKSPACE.md if they exist
        if (existsSync(join(gitRoot, 'STATE.md'))) {
          await execAsync(`git add STATE.md`, { cwd: gitRoot, encoding: 'utf-8' });
        }
        if (existsSync(join(gitRoot, 'WORKSPACE.md'))) {
          await execAsync(`git add WORKSPACE.md`, { cwd: gitRoot, encoding: 'utf-8' });
        }

        // Check if there are changes to commit
        try {
          await execAsync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' });
          // No changes to commit
          console.log(`No planning changes to commit for ${issueId}`);
        } catch (diffErr) {
          // There are changes, commit and push them
          await execAsync(`git commit -m "Planning artifacts for ${issueId} before agent start"`, { cwd: gitRoot, encoding: 'utf-8' });
          // Push in background (non-blocking to avoid freezing dashboard)
          const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
          pushChild.unref();
          console.log(`[start-agent] Committed and pushed planning artifacts for ${issueId} (push in background)`);
        }
      } catch (gitErr) {
        console.error('Git commit/push of planning artifacts failed:', gitErr);
        // Continue even if git fails - don't block agent start
      }
    }

    // For REMOTE workspaces, spawn agent on remote VM
    if (isRemote && workspaceMetadata) {
      console.log(`[start-agent] Spawning REMOTE agent for ${issueId} on ${workspaceMetadata.vmName}`);

      // Sync credentials and spawn remote agent
      const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
      const { spawnRemoteAgent } = await import('../../lib/remote/remote-agents.js');
      const exe = createExeProvider({ infraVm: workspaceMetadata.infraVm });
      await exe.syncAllCredentials(workspaceMetadata.vmName);

      // Generate initial prompt for the agent
      const { buildWorkAgentPrompt } = await import('../../lib/cloister/work-agent-prompt.js');
      const agentPrompt = buildWorkAgentPrompt({
        issueId,
        env: 'REMOTE',
        workspacePath: '/workspace',
        skipDynamicContext: true,
      });

      const state = await spawnRemoteAgent({
        issueId,
        workspace: workspaceMetadata,
        prompt: agentPrompt,
      });

      console.log(`[start-agent] Remote agent spawned for ${issueId}: ${state.id}`);

      // Update issue status (GitHub/Linear) - same logic as local
      const apiKey = getLinearApiKey();
      const isGitHubIssue = issueId.startsWith('PAN-');

      if (isGitHubIssue) {
        try {
          const ghConfig = getGitHubConfig();
          if (ghConfig) {
            const number = parseInt(issueId.split('-')[1], 10);
            const repoConfig = ghConfig.repos.find(r => r.prefix === 'PAN') || ghConfig.repos[0];
            const { owner, repo } = repoConfig;
            const token = ghConfig.token;

            await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/planned`, {
              method: 'DELETE',
              headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
            }).catch(() => {});

            await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
              method: 'POST',
              headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ labels: ['in-progress'] }),
            });
            console.log(`Updated ${issueId} GitHub labels to in-progress`);
          }
        } catch (ghError) {
          console.error('Failed to update GitHub labels:', ghError);
        }
      }

      return res.json({
        success: true,
        message: `Starting remote agent for ${issueId}`,
        remote: true,
        vmName: workspaceMetadata.vmName,
        agentId: state.id,
        projectPath,
      });
    }

    // LOCAL workspace: start containers if workspace has ./dev script
    // We must wait for containers to be ready BEFORE starting the agent
    const devScript = join(workspacePath, 'dev');
    let containerActivityId: string | null = null;
    let containersReady = false;

    if (existsSync(workspacePath) && existsSync(devScript)) {
      // Check if Docker is running
      let dockerRunning = false;
      try {
        await execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
        dockerRunning = true;
      } catch {
        console.log('[start-agent] Docker not running, skipping container start');
      }

      if (dockerRunning) {
        containerActivityId = `containers-${Date.now()}`;
        const featureName = `myn-feature-${issueLower}`;

        logActivity({
          id: containerActivityId,
          timestamp: new Date().toISOString(),
          command: `./dev all (${issueId}) - waiting for containers`,
          status: 'running',
          output: [],
        });

        // Pass UID/GID for correct file ownership in containers
        const containerUid = process.getuid?.() ?? 1000;
        const containerGid = process.getgid?.() ?? 1000;

        // Start containers (don't detach - we need to track completion)
        const containerPromise = new Promise<boolean>((resolve) => {
          const containerChild = spawn('./dev', ['all'], {
            cwd: workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, UID: String(containerUid), GID: String(containerGid), DOCKER_USER: `${containerUid}:${containerGid}` },
          });

          containerChild.stdout?.on('data', (data) => {
            data.toString().split('\n').filter(Boolean).forEach((line: string) => {
              appendActivityOutput(containerActivityId!, line);
            });
          });
          containerChild.stderr?.on('data', (data) => {
            data.toString().split('\n').filter(Boolean).forEach((line: string) => {
              appendActivityOutput(containerActivityId!, `[stderr] ${line}`);
            });
          });

          containerChild.on('close', (code) => {
            appendActivityOutput(containerActivityId!, `[${new Date().toISOString()}] ./dev all exited with code ${code}`);
            updateActivity(containerActivityId!, { status: code === 0 ? 'completed' : 'failed' });
            resolve(code === 0);
          });

          containerChild.on('error', (err) => {
            appendActivityOutput(containerActivityId!, `[error] ${err.message}`);
            updateActivity(containerActivityId!, { status: 'failed' });
            resolve(false);
          });

          // Timeout after 5 minutes
          setTimeout(() => {
            appendActivityOutput(containerActivityId!, '[timeout] Container startup exceeded 5 minutes');
            containerChild.kill('SIGTERM');
            resolve(false);
          }, 5 * 60 * 1000);
        });

        console.log(`[start-agent] Starting containers for ${issueId}, waiting for ready...`);
        appendActivityOutput(containerActivityId, `[${new Date().toISOString()}] Starting containers...`);

        // Wait for ./dev all to complete
        const devCompleted = await containerPromise;

        if (devCompleted) {
          // Now poll for container health (some containers have healthchecks)
          const maxWaitMs = 60000; // 60 seconds
          const pollIntervalMs = 2000;
          const startTime = Date.now();

          appendActivityOutput(containerActivityId, `[${new Date().toISOString()}] Checking container health...`);

          while (Date.now() - startTime < maxWaitMs) {
            try {
              const { stdout } = await execAsync(
                `docker ps --filter "name=${featureName}" --format "{{.Names}}|{{.Status}}"`,
                { encoding: 'utf-8' }
              );

              const containers = stdout.trim().split('\n').filter(Boolean);
              const allHealthy = containers.length > 0 && containers.every(line => {
                const status = line.split('|')[1] || '';
                // Container is ready if it's "Up" and either has no healthcheck or is "(healthy)"
                return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
              });

              if (allHealthy) {
                containersReady = true;
                appendActivityOutput(containerActivityId, `[${new Date().toISOString()}] All ${containers.length} containers ready`);
                console.log(`[start-agent] All ${containers.length} containers ready for ${issueId}`);
                break;
              }

              await new Promise(r => setTimeout(r, pollIntervalMs));
            } catch (healthErr) {
              console.error('[start-agent] Error checking container health:', healthErr);
              await new Promise(r => setTimeout(r, pollIntervalMs));
            }
          }

          if (!containersReady) {
            appendActivityOutput(containerActivityId, `[${new Date().toISOString()}] Warning: Container health check timed out, proceeding anyway`);
            console.warn(`[start-agent] Container health check timed out for ${issueId}`);
            containersReady = true; // Proceed anyway, agent can handle it
          }
        } else {
          appendActivityOutput(containerActivityId, `[${new Date().toISOString()}] Container startup failed`);
          console.error(`[start-agent] Container startup failed for ${issueId}`);
          return res.status(500).json({
            error: `Container startup failed for ${issueId}`,
            hint: 'Check activity log for details',
            activityId: containerActivityId,
          });
        }
      }
    }

    // NOW spawn the agent (after containers are ready)
    const phase = req.body.phase || 'exploration';
    const activityId = spawnPanCommand(
      ['work', 'issue', issueId, '--phase', phase],
      `Start agent for ${issueId}`,
      projectPath
    );

    console.log(`[start-agent] Agent spawned for ${issueId} (containers ready: ${containersReady})`);

    // Update issue status to "In Progress"
    const apiKey = getLinearApiKey();
    const isGitHubIssue = issueId.startsWith('PAN-');

    if (isGitHubIssue) {
      // GitHub issue - add "in-progress" label, remove "planned" label
      try {
        const ghConfig = getGitHubConfig();
        if (ghConfig) {
          const number = parseInt(issueId.split('-')[1], 10);
          // Find the repo config that matches this issue prefix
          const repoConfig = ghConfig.repos.find(r => r.prefix === 'PAN') || ghConfig.repos[0];
          const { owner, repo } = repoConfig;
          const token = ghConfig.token;

          // Remove "planned" label if present
          await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/planned`, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          }).catch(() => {}); // Ignore if label doesn't exist

          // Add "in-progress" label
          await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ labels: ['in-progress'] }),
          });

          console.log(`Updated ${issueId} GitHub labels to in-progress`);
        }
      } catch (ghError) {
        console.error('Failed to update GitHub labels:', ghError);
      }
    } else if (apiKey) {
      // It's a Linear issue, update status
      try {
        // First get the issue to find the team's "In Progress" state
        const getIssueQuery = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              team {
                states {
                  nodes {
                    id
                    name
                    type
                  }
                }
              }
            }
          }
        `;

        const issueResponse = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey,
          },
          body: JSON.stringify({ query: getIssueQuery, variables: { id: issueId } }),
        });

        const issueJson = await issueResponse.json();
        const states = issueJson.data?.issue?.team?.states?.nodes || [];
        const inProgressState = states.find((s: any) => s.type === 'started' || s.name.toLowerCase() === 'in progress');

        if (inProgressState && issueJson.data?.issue?.id) {
          // Update the issue state
          const updateMutation = `
            mutation UpdateIssue($id: String!, $stateId: String!) {
              issueUpdate(id: $id, input: { stateId: $stateId }) {
                success
              }
            }
          `;

          await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey,
            },
            body: JSON.stringify({
              query: updateMutation,
              variables: { id: issueJson.data.issue.id, stateId: inProgressState.id },
            }),
          });

          console.log(`Updated ${issueId} status to In Progress`);
        }
      } catch (linearError) {
        console.error('Failed to update Linear status:', linearError);
        // Don't fail the request, agent was still started
      }
    }

    res.json({
      success: true,
      message: `Starting agent for ${issueId}`,
      activityId,
      containerActivityId,
      projectPath,
    });
  } catch (error: any) {
    console.error('Error starting agent:', error);
    res.status(500).json({ error: 'Failed to start agent: ' + error.message });
  }
});

// Get skills
app.get('/api/skills', (_req, res) => {
  try {
    const skills: Array<{
      name: string;
      path: string;
      source: string;
      hasSkillMd: boolean;
      description?: string;
    }> = [];

    // Check both skill locations
    const skillLocations = [
      { path: join(homedir(), '.panopticon', 'skills'), source: 'panopticon' },
      { path: join(homedir(), '.claude', 'skills'), source: 'claude' },
    ];

    for (const { path: skillsDir, source } of skillLocations) {
      if (!existsSync(skillsDir)) continue;

      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = join(skillsDir, entry.name);
        const skillMdPath = join(skillPath, 'SKILL.md');
        const hasSkillMd = existsSync(skillMdPath);

        let description: string | undefined;
        if (hasSkillMd) {
          try {
            const content = readFileSync(skillMdPath, 'utf-8');
            // Extract first line or sentence as description
            const firstLine = content.split('\n').find(line =>
              line.trim() && !line.startsWith('#') && !line.startsWith('---')
            );
            description = firstLine?.trim().slice(0, 100);
          } catch {}
        }

        skills.push({
          name: entry.name,
          path: skillPath,
          source,
          hasSkillMd,
          description,
        });
      }
    }

    res.json(skills);
  } catch (error) {
    console.error('Error listing skills:', error);
    res.json([]);
  }
});

// Helper to detect if an issue ID is from GitHub
function isGitHubIssue(issueId: string): { isGitHub: boolean; owner?: string; repo?: string; number?: number } {
  const config = getGitHubConfig();
  if (!config) return { isGitHub: false };

  // Check if the prefix matches any configured GitHub repo
  const prefix = issueId.split('-')[0].toUpperCase();
  for (const { owner, repo, prefix: repoPrefix } of config.repos) {
    const configPrefix = (repoPrefix || repo).toUpperCase();
    if (prefix === configPrefix) {
      const number = parseInt(issueId.split('-')[1], 10);
      if (!isNaN(number)) {
        return { isGitHub: true, owner, repo, number };
      }
    }
  }

  return { isGitHub: false };
}

// Fetch GitHub issue details
async function fetchGitHubIssue(owner: string, repo: string, number: number): Promise<any> {
  const config = getGitHubConfig();
  if (!config) throw new Error('GitHub not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
    {
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Panopticon-Dashboard',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
}

// Add "planning" label to GitHub issue
async function addGitHubPlanningLabel(owner: string, repo: string, number: number): Promise<void> {
  const config = getGitHubConfig();
  if (!config) throw new Error('GitHub not configured');

  // First, try to create the label if it doesn't exist
  try {
    await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Panopticon-Dashboard',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'planning',
        color: 'a855f7', // Purple
        description: 'Issue is in planning/discovery phase',
      }),
    });
  } catch {
    // Label might already exist, that's fine
  }

  // Add the label to the issue
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Panopticon-Dashboard',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels: ['planning'] }),
  });
}

// Start planning for an issue - moves to "In Planning", creates workspace, spawns planning agent
app.post('/api/issues/:id/start-planning', async (req, res) => {
  const { id } = req.params;
  const { skipWorkspace = false, startDocker = false, workspaceLocation = 'local', shadowMode = false } = req.body;
  console.log(`[start-planning] START for ${id}, workspaceLocation=${workspaceLocation}, shadow=${shadowMode}`);

  try {
    // Check if a work agent is already running for this issue
    // Don't allow planning when execution is in progress
    const issueLowerForCheck = id.toLowerCase();
    try {
      const { stdout: sessions } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
      const workAgentSession = sessions
        .trim()
        .split('\n')
        .find(s => s === `agent-${issueLowerForCheck}`);

      if (workAgentSession) {
        return res.status(409).json({
          error: `Cannot start planning: work agent already running for ${id.toUpperCase()}`,
          hint: 'Stop the agent first or use the terminal view to interact with it',
          existingSession: workAgentSession,
        });
      }
    } catch (tmuxError) {
      // tmux not running or error checking - continue with planning
      console.log('[start-planning] Could not check existing agents:', tmuxError);
    }

    // Check if this is a GitHub issue
    const githubCheck = isGitHubIssue(id);

    let issue: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      url: string;
      source: 'linear' | 'github';
    };
    let newStateName = 'In Planning';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      // Handle GitHub issue
      const ghIssue = await fetchGitHubIssue(githubCheck.owner, githubCheck.repo, githubCheck.number);

      // Find the prefix for this repo
      const config = getGitHubConfig()!;
      const repoConfig = config.repos.find(r => r.owner === githubCheck.owner && r.repo === githubCheck.repo);
      const prefix = repoConfig?.prefix || githubCheck.repo.toUpperCase();

      issue = {
        id: `github-${githubCheck.owner}-${githubCheck.repo}-${githubCheck.number}`,
        identifier: `${prefix}-${githubCheck.number}`,
        title: ghIssue.title,
        description: ghIssue.body || '',
        url: ghIssue.html_url,
        source: 'github',
      };

      // Add "planning" label to GitHub issue
      console.log(`[start-planning] Fetched GitHub issue, adding planning label...`);
      await addGitHubPlanningLabel(githubCheck.owner, githubCheck.repo, githubCheck.number);
      newStateName = 'Planning (label added)';
      console.log(`[start-planning] GitHub issue setup complete`);

    } else {
      // Handle Linear issue
      const apiKey = getLinearApiKey();
      if (!apiKey) {
        return res.status(500).json({ error: 'LINEAR_API_KEY not configured' });
      }

      // 1. Fetch issue details
      const issueQuery = `
        query GetIssue($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            description
            url
            state { id name }
            team { id key }
          }
        }
      `;

      const issueResponse = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({ query: issueQuery, variables: { id } }),
      });
      const issueJson = await issueResponse.json();
      if (issueJson.errors) throw new Error(issueJson.errors[0]?.message || 'GraphQL error');
      const linearIssue = issueJson.data?.issue;

      if (!linearIssue) {
        return res.status(404).json({ error: 'Issue not found' });
      }

      // 2. Find "In Planning" state for this team
      const statesQuery = `
        query GetTeamStates($teamId: String!) {
          team(id: $teamId) {
            states {
              nodes {
                id
                name
                type
              }
            }
          }
        }
      `;

      const statesResponse = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({ query: statesQuery, variables: { teamId: linearIssue.team.id } }),
      });
      const statesJson = await statesResponse.json();
      if (statesJson.errors) throw new Error(statesJson.errors[0]?.message || 'GraphQL error');

      const states = statesJson.data?.team?.states?.nodes || [];
      const planningState = states.find((s: any) =>
        s.name.toLowerCase().includes('planning') ||
        s.name.toLowerCase() === 'planned'
      );

      if (!planningState) {
        return res.status(400).json({
          error: 'No "In Planning" state found in Linear. Please add it to your team workflow.',
          hint: 'Go to Linear → Settings → Teams → Workflow → Add "In Planning" under Started',
        });
      }

      // 3. Move issue to "In Planning" state
      const updateMutation = `
        mutation UpdateIssue($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue {
              id
              identifier
              state { name }
            }
          }
        }
      `;

      const updateResponse = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({
          query: updateMutation,
          variables: { id: linearIssue.id, stateId: planningState.id },
        }),
      });
      const updateJson = await updateResponse.json();
      if (updateJson.errors) throw new Error(updateJson.errors[0]?.message || 'Failed to update issue');

      issue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        url: linearIssue.url,
        source: 'linear',
      };
      newStateName = planningState.name;
    }

    // 4. Create workspace (git worktree) if not skipped
    const mappings = getProjectMappings();
    const prefix = issue.identifier.split('-')[0];
    const mapping = mappings.find(m => m.linearPrefix.toUpperCase() === prefix.toUpperCase());

    // For GitHub issues, check if there's a mapping, otherwise use the GitHub config's local path
    let projectPath: string;
    if (mapping?.localPath) {
      projectPath = mapping.localPath;
    } else if (issue.source === 'github' && githubCheck.owner && githubCheck.repo) {
      // Try to find local path from GitHub config
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || getDefaultProjectPath();
    } else {
      projectPath = getDefaultProjectPath();
    }
    const issueLower = issue.identifier.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    let workspaceCreated = false;
    let workspaceError: string | undefined;
    let existingRemoteWorkspace: any = null;

    // Check for existing remote workspace FIRST (before trying to create)
    console.log(`[start-planning] Checking for existing workspace, location=${workspaceLocation}`);
    if (workspaceLocation === 'remote') {
      try {
        const { loadWorkspaceMetadata } = await import('../../lib/remote/workspace-metadata.js');
        console.log(`[start-planning] Loading workspace metadata for ${issue.identifier}...`);
        existingRemoteWorkspace = loadWorkspaceMetadata(issue.identifier);
        if (existingRemoteWorkspace) {
          console.log(`[start-planning] Found existing remote workspace: ${existingRemoteWorkspace.vmName}`);
          workspaceCreated = true; // Remote workspace already exists
        } else {
          console.log(`[start-planning] No existing remote workspace found`);
        }
      } catch (err) {
        console.log('[start-planning] Could not check for existing remote workspace:', err);
      }
    }

    if (!skipWorkspace && !workspaceCreated) {
      try {
        // Check if workspace needs to be created
        // A workspace with only .planning is incomplete (from a failed previous attempt)
        const workspaceNeedsCreation = !existsSync(workspacePath) ||
          (existsSync(workspacePath) && readdirSync(workspacePath).every(f => f === '.planning'));

        if (workspaceNeedsCreation) {
          // Create workspace using pan workspace create
          const dockerFlag = startDocker ? ' --docker' : '';
          const locationFlag = workspaceLocation === 'remote' ? ' --remote' : ' --local';
          const createCmd = `pan workspace create ${issue.identifier}${locationFlag}${dockerFlag}`;
          const activityId = Date.now().toString();
          logActivity({
            id: activityId,
            timestamp: new Date().toISOString(),
            command: createCmd,
            status: 'running',
            output: [],
          });

          // Run pan workspace create (may call custom workspace_command for complex projects)
          // With --docker, containers start in background (up to 5 min timeout for builds)
          await execAsync(createCmd, {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: startDocker ? 300000 : 120000, // 5 min with docker, 2 min without
          });
          workspaceCreated = true;

          // If we just created a remote workspace, reload the metadata
          if (workspaceLocation === 'remote') {
            try {
              const { loadWorkspaceMetadata } = await import('../../lib/remote/workspace-metadata.js');
              existingRemoteWorkspace = loadWorkspaceMetadata(issue.identifier);
              if (existingRemoteWorkspace) {
                console.log(`[start-planning] Remote workspace created: ${existingRemoteWorkspace.vmName}`);
              }
            } catch (err) {
              console.log('[start-planning] Could not load new remote workspace metadata:', err);
            }
          }

          const successMsg = startDocker
            ? 'Workspace created, Docker containers starting in background'
            : 'Workspace created successfully';
          appendActivityOutput(activityId, successMsg);
        } else {
          workspaceCreated = true; // Already exists
        }
      } catch (err: any) {
        workspaceError = err.message;
        console.error('Workspace creation error:', err);
      }
    }

    // 5. Spawn planning agent (local tmux or remote VM)
    const sessionName = `planning-${issueLower}`;
    let planningAgentStarted = false;
    let planningAgentError: string | undefined;
    let isRemotePlanning = false;

    // Use existing remote workspace metadata if we already loaded it
    let remoteWorkspaceMetadata: any = existingRemoteWorkspace;
    if (workspaceLocation === 'remote' && workspaceCreated && remoteWorkspaceMetadata) {
      // Verify VM exists AND /workspace is properly set up (has .git directory)
      console.log(`[start-planning] Verifying remote workspace on ${remoteWorkspaceMetadata.vmName}...`);
      try {
        const { stdout } = await execAsync(
          `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${remoteWorkspaceMetadata.vmName}.exe.xyz "test -d /workspace/.git && echo 'ready' || echo 'not-ready'"`,
          { timeout: 15000 }
        );
        if (stdout.trim() === 'ready') {
          isRemotePlanning = true;
          console.log(`[start-planning] Remote workspace verified on VM: ${remoteWorkspaceMetadata.vmName}`);
        } else {
          throw new Error('Workspace /workspace/.git not found');
        }
      } catch (vmCheckErr: any) {
        console.log(`[start-planning] Remote workspace not ready on ${remoteWorkspaceMetadata.vmName}: ${vmCheckErr.message}`);
        // Workspace not properly set up - clear stale metadata and recreate
        remoteWorkspaceMetadata = null;
        workspaceCreated = false;
        // Remove stale workspace metadata so workspace create runs
        try {
          const { deleteWorkspaceMetadata } = await import('../../lib/remote/workspace-metadata.js');
          deleteWorkspaceMetadata(issue.identifier);
          console.log(`[start-planning] Cleared stale workspace metadata, will recreate workspace`);
        } catch {
          // Ignore cleanup errors
        }
        // Also clear stale agent state if exists
        const staleAgentDir = join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`);
        if (existsSync(staleAgentDir)) {
          await execAsync(`rm -rf "${staleAgentDir}"`, { encoding: 'utf-8' });
          console.log(`[start-planning] Cleared stale agent state: ${staleAgentDir}`);
        }
      }
    }

    try {
      // Kill existing planning session if any
      // IMPORTANT: Always kill LOCAL session first to prevent WebSocket connecting to stale local session
      // when starting a remote agent (see PAN-105 terminal sync bug)
      await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

      // Also kill remote session if we're starting a remote agent
      if (isRemotePlanning && remoteWorkspaceMetadata) {
        const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
        const exe = createExeProvider({ infraVm: remoteWorkspaceMetadata.infraVm });
        await exe.ssh(remoteWorkspaceMetadata.vmName, `tmux kill-session -t ${sessionName} 2>/dev/null || true`);
      }

      // Create planning prompt file - store IN workspace if exists (for git-backed planning)
      // For remote workspaces, we'll write to the remote VM later
      const planningDir = workspaceCreated && !isRemotePlanning
        ? join(workspacePath, '.planning')
        : join(projectPath, '.planning', issueLower);
      if (!existsSync(planningDir)) {
        await execAsync(`mkdir -p "${planningDir}"`, { encoding: 'utf-8' });
      }

      // Initialize .planning subdirectories for Mission Control
      for (const subdir of ['transcripts', 'discussions', 'notes']) {
        const subdirPath = join(planningDir, subdir);
        if (!existsSync(subdirPath)) {
          mkdirSync(subdirPath, { recursive: true });
        }
      }

      // Initialize Shadow Engineering if enabled
      if (shadowMode) {
        const inferencePath = join(planningDir, 'INFERENCE.md');
        if (!existsSync(inferencePath)) {
          writeFileSync(inferencePath, `# Inference Document - ${id.toUpperCase()}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n`, 'utf-8');
          console.log(`[start-planning] Shadow Engineering: Initialized INFERENCE.md`);
        }
      }

      // Clear stale STATE.md from previous planning session (start fresh)
      // This prevents new planning agents from seeing old state and thinking work is done
      const staleStatePath = join(planningDir, 'STATE.md');
      if (existsSync(staleStatePath)) {
        console.log(`[start-planning] Clearing stale STATE.md from previous session`);
        await execAsync(`rm -f "${staleStatePath}"`, { encoding: 'utf-8' });
      }

      const planningPromptPath = join(planningDir, 'PLANNING_PROMPT.md');

      // Get project config for structure context
      const teamPrefix = extractTeamPrefix(issue.identifier);
      const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

      // Generate project structure context for polyrepos
      let projectStructureSection = '';
      if (projectConfig?.workspace?.type === 'polyrepo' && projectConfig.workspace.repos) {
        const repos = projectConfig.workspace.repos;
        projectStructureSection = `
## Project Structure (Polyrepo)

**IMPORTANT:** This project uses a **polyrepo** structure. The workspace root is NOT a git repository.
Each subdirectory is a separate git worktree:

| Directory | Purpose |
|-----------|---------|
${repos.map(r => `| \`${r.name}/\` | Git worktree for ${r.path} |`).join('\n')}

**Git operations:**
- Run \`git status\`, \`git log\`, etc. INSIDE the subdirectories (e.g., \`cd fe && git status\`)
- The workspace root (\`${workspacePath}\`) has no \`.git\` directory
- Each subdirectory has its own branch: \`${repos[0]?.branch_prefix || 'feature/'}${issue.identifier.toLowerCase()}\`

`;
      }

      const planningPrompt = `# Planning Session: ${issue.identifier}

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via \`bd create\`)
  - PRD file at \`docs/prds/active/{issue-id}-plan.md\` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** ${issue.identifier}
- **Title:** ${issue.title}
- **URL:** ${issue.url}

## Description
${issue.description || 'No description provided'}
${projectStructureSection}
---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| \`trivial\` | Typo, comment, formatting only | haiku |
| \`simple\` | Bug fix, single file, obvious change | haiku |
| \`medium\` | New feature, 3-5 files, standard patterns | sonnet |
| \`complex\` | Refactor, migration, 6+ files, some risk | sonnet |
| \`expert\` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

When creating beads tasks, include difficulty labels:
\`\`\`bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
\`\`\`

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to PRD at \`docs/prds/active/{issue-id}-plan.md\` (required for dashboard)
3. Create beads tasks with dependencies using \`bd create\` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
`;

      // Get planning agent model from settings
      const agentSettings = loadSettings();
      const planningModel = agentSettings.models.planning_agent;
      const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
      await execAsync(`mkdir -p "${agentStateDir}"`, { encoding: 'utf-8' });

      if (isRemotePlanning && remoteWorkspaceMetadata) {
        // ===== REMOTE PLANNING AGENT =====
        console.log(`[start-planning] Spawning remote planning agent on ${remoteWorkspaceMetadata.vmName}`);

        const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
        const exe = createExeProvider({ infraVm: remoteWorkspaceMetadata.infraVm });
        const vmName = remoteWorkspaceMetadata.vmName;

        // Sync all credentials before spawning (tokens may have expired)
        console.log(`[start-planning] Syncing credentials to ${vmName}...`);
        await exe.syncAllCredentials(vmName);

        // Also write planning prompt LOCALLY for debugging and consistency
        console.log(`[start-planning] Writing planning prompt locally to ${planningPromptPath}`);
        writeFileSync(planningPromptPath, planningPrompt);

        // Install bd (beads CLI) on remote if not present
        console.log(`[start-planning] Ensuring bd (beads CLI) is available on ${vmName}...`);
        const bdInstalled = await exe.installBeads(vmName);
        if (!bdInstalled) {
          console.warn(`[start-planning] bd installation failed on ${vmName} - beads tasks may not work`);
        }

        // Initialize beads on remote workspace
        console.log(`[start-planning] Initializing beads on ${vmName}...`);
        await exe.initBeads(vmName, '/workspace');

        // Write planning prompt to remote VM
        const remotePlanningDir = '/workspace/.planning';
        const remotePlanningPromptPath = `${remotePlanningDir}/PLANNING_PROMPT.md`;

        console.log(`[start-planning] Step 1: mkdir -p ${remotePlanningDir}`);
        await exe.ssh(vmName, `mkdir -p ${remotePlanningDir}`);
        console.log(`[start-planning] Step 1 complete`);

        // Clear stale STATE.md on remote
        console.log(`[start-planning] Step 2: rm -f STATE.md`);
        await exe.ssh(vmName, `rm -f ${remotePlanningDir}/STATE.md`);
        console.log(`[start-planning] Step 2 complete`);

        // Write planning prompt to remote using base64 to avoid heredoc escaping issues
        console.log(`[start-planning] Step 3: write planning prompt`);
        const promptBase64 = Buffer.from(planningPrompt).toString('base64');
        await exe.ssh(vmName, `echo '${promptBase64}' | base64 -d > ${remotePlanningPromptPath}`);
        console.log(`[start-planning] Step 3 complete`);

        // Create launcher script on remote
        const initMessage = `Please read the planning prompt file at ${remotePlanningPromptPath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
        const remotePromptFile = `/workspace/.panopticon/prompts/${sessionName}.txt`;
        const remoteLauncherScript = `/workspace/.panopticon/prompts/${sessionName}-launcher.sh`;

        console.log(`[start-planning] Step 4: create launcher files`);
        await exe.ssh(vmName, `mkdir -p /workspace/.panopticon/prompts`);

        // Write init message using base64
        const initMsgBase64 = Buffer.from(initMessage).toString('base64');
        await exe.ssh(vmName, `echo '${initMsgBase64}' | base64 -d > ${remotePromptFile}`);

        // Write launcher script using base64
        const launcherContent = `#!/bin/bash
# Set terminal environment for proper rendering
export TERM=xterm-256color
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export COLORTERM=truecolor
export PATH="/usr/local/bin:\$PATH"

cd /workspace
prompt=$(cat "${remotePromptFile}")
exec claude --dangerously-skip-permissions --model ${planningModel} "$prompt"
`;
        const launcherBase64 = Buffer.from(launcherContent).toString('base64');
        await exe.ssh(vmName, `echo '${launcherBase64}' | base64 -d > ${remoteLauncherScript}`);
        console.log(`[start-planning] Step 4 complete`);
        await exe.ssh(vmName, `chmod +x ${remoteLauncherScript}`);

        // Step 5: Configure Claude Code for autonomous operation (bypass permissions + skip onboarding)
        console.log(`[start-planning] Step 5: configure Claude Code`);
        await exe.configureClaudeCode(vmName);
        console.log(`[start-planning] Step 5 complete`);

        // Step 5.1: Copy essential skills to remote VM
        console.log(`[start-planning] Step 5.1: copy skills to ${vmName}`);
        await exe.copySkillsToVm(vmName);
        console.log(`[start-planning] Step 5.1 complete`);

        // Step 5.5: Configure tmux for proper terminal handling
        console.log(`[start-planning] Step 5.5: configure tmux`);
        const tmuxConf = `
# Panopticon tmux settings for proper terminal rendering
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
set -g mouse on
set -s escape-time 0
`;
        const tmuxConfBase64 = Buffer.from(tmuxConf).toString('base64');
        await exe.ssh(vmName, `grep -q "Panopticon tmux settings" ~/.tmux.conf 2>/dev/null || echo '${tmuxConfBase64}' | base64 -d >> ~/.tmux.conf`);
        console.log(`[start-planning] Step 5.5 complete`);

        // Start tmux session on remote VM with proper terminal settings
        const tmuxResult = await exe.ssh(vmName, `TERM=xterm-256color tmux new-session -d -s ${sessionName} -c /workspace "bash '${remoteLauncherScript}'"`);

        if (tmuxResult.exitCode !== 0) {
          throw new Error(`Failed to start remote planning agent: ${tmuxResult.stderr}`);
        }

        // Resize remote tmux window
        await exe.ssh(vmName, `tmux resize-window -t ${sessionName} -x 200 -y 50 2>/dev/null || true`);

        // Write agent state file with remote info
        writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
          id: sessionName,
          issueId: issue.identifier,
          workspace: '/workspace',
          runtime: 'claude',
          model: planningModel,
          status: 'running',
          startedAt: new Date().toISOString(),
          type: 'planning',
          location: 'remote',
          vmName: vmName,
          infraVm: remoteWorkspaceMetadata.infraVm,
        }, null, 2));

        console.log(`Started remote planning agent ${sessionName} on ${vmName}`);

      } else {
        // ===== LOCAL PLANNING AGENT =====
        writeFileSync(planningPromptPath, planningPrompt);

        // Determine working directory - use workspace if created, otherwise project root
        const agentCwd = workspaceCreated ? workspacePath : projectPath;

        // Start tmux session with Claude Code for planning (interactive TUI mode)
        // Use a launcher script to safely pass the prompt (avoids shell escaping issues)
        const initMessage = `Please read the planning prompt file at ${planningPromptPath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
        const agentCmd = getAgentCommand(planningModel);

        // Write a launcher script that safely passes the prompt
        const launcherScript = join(agentStateDir, 'launcher.sh');
        const promptFile = join(agentStateDir, 'init-prompt.txt');
        writeFileSync(promptFile, initMessage);

        // Build the command - use 'claude' directly for Anthropic models, 'claude-code-router' for others
        // Add --dangerously-skip-permissions to bypass the trust prompt for automated agents
        const cmdWithArgs = agentCmd.args.length > 0
          ? `${agentCmd.command} ${agentCmd.args.join(' ')} --dangerously-skip-permissions`
          : `${agentCmd.command} --dangerously-skip-permissions`;

        writeFileSync(launcherScript, `#!/bin/bash
cd "${agentCwd}"
prompt=$(cat "${promptFile}")
exec ${cmdWithArgs} "$prompt"
`, { mode: 0o755 });

        // Ensure tmux is running before starting session
        await ensureTmuxRunning();
        await execAsync(`tmux new-session -d -s ${sessionName} "bash '${launcherScript}'"`, { encoding: 'utf-8' });

        // Write agent state file so QuestionDialog can find the JSONL path
        writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
          id: sessionName,
          issueId: issue.identifier,
          workspace: agentCwd,
          runtime: isAnthropicModel(planningModel) ? 'claude' : 'claude-code-router',
          model: planningModel,
          status: 'running',
          startedAt: new Date().toISOString(),
          type: 'planning',
          location: 'local',
        }, null, 2));

        // Resize the tmux window to be wide enough for Claude's TUI
        try {
          await execAsync(`tmux resize-window -t ${sessionName} -x 200 -y 50 2>/dev/null`, { encoding: 'utf-8' });
        } catch {
          // Ignore resize errors
        }

        console.log(`Started local planning agent ${sessionName} with initial prompt`);
      }

      planningAgentStarted = true;
    } catch (err: any) {
      planningAgentError = err.message;
      console.error('Planning agent error:', err);
    }

    res.json({
      success: true,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        newState: newStateName,
        source: issue.source,
      },
      workspace: {
        created: workspaceCreated,
        path: workspacePath,
        error: workspaceError,
      },
      planningAgent: {
        started: planningAgentStarted,
        sessionName: planningAgentStarted ? sessionName : undefined,
        error: planningAgentError,
      },
    });
  } catch (error: any) {
    console.error('Error starting planning:', error);
    res.status(500).json({ error: 'Failed to start planning: ' + error.message });
  }
});

// Get planning session status
app.get('/api/planning/:issueId/status', async (req, res) => {
  const { issueId } = req.params;
  const sessionName = `planning-${issueId.toLowerCase()}`;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  try {
    // Check agent state to see if this is a remote session
    let isRemote = false;
    let vmName = '';
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
    const stateFile = join(agentStateDir, 'state.json');

    try {
      if (existsSync(stateFile)) {
        const stateContent = readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(stateContent);
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
        }
      }
    } catch (err) {
      // Ignore - will check locally
    }

    // Check if tmux session exists (local or remote)
    let sessionExists = false;
    if (isRemote && vmName) {
      try {
        const { stdout } = await execAsync(`ssh -A -o ConnectTimeout=5 ${vmName}.exe.xyz "tmux list-sessions -F '#{session_name}' 2>/dev/null || echo ''"`, { timeout: 10000 });
        const sessions = stdout.trim().split('\n').filter(Boolean);
        sessionExists = sessions.includes(sessionName);
      } catch (err) {
        // SSH failed - session might still exist but VM unreachable
        console.log(`[planning status] SSH to ${vmName} failed:`, err);
      }
    } else {
      const { stdout: sessionsOutput } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""', {
        encoding: 'utf-8',
      });
      const sessions = sessionsOutput.trim().split('\n').filter(Boolean);
      sessionExists = sessions.includes(sessionName);
    }

    // Check if planning artifacts exist
    const planningDirInWorkspace = join(workspacePath, '.planning');
    const legacyPlanningDir = join(projectPath, '.planning', issueLower);
    const planningDir = existsSync(planningDirInWorkspace) ? planningDirInWorkspace :
                        existsSync(legacyPlanningDir) ? legacyPlanningDir : null;

    const hasStateFile = planningDir ? existsSync(join(planningDir, 'STATE.md')) : false;
    const hasPromptFile = planningDir ? existsSync(join(planningDir, 'PLANNING_PROMPT.md')) : false;

    // Planning is only "completed" if explicitly marked via the .planning-complete marker file
    // This prevents false positives when session crashes or exits unexpectedly
    const hasCompletionMarker = planningDir ? existsSync(join(planningDir, '.planning-complete')) : false;

    // Check STATE.md for explicit completion status (look for "## Status: Complete" marker)
    let hasStatusComplete = false;
    if (hasStateFile && planningDir) {
      try {
        const stateContent = readFileSync(join(planningDir, 'STATE.md'), 'utf-8');
        // Look for explicit completion markers in STATE.md
        hasStatusComplete = /##\s*Status:\s*Complete/i.test(stateContent) ||
                          /##\s*Planning Status:\s*Complete/i.test(stateContent);
      } catch {
        // Ignore read errors
      }
    }

    // Planning is completed ONLY if there's an explicit completion marker OR STATE.md says complete
    // Having STATE.md alone doesn't mean planning is done - it's a working document
    const planningCompleted = hasCompletionMarker || hasStatusComplete;

    res.json({
      active: sessionExists,
      sessionName,
      workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
      planningCompleted,
      hasStateFile,
      hasPromptFile,
      hasCompletionMarker,
      isRemote,
      vmName: isRemote ? vmName : undefined,
    });
  } catch (error: any) {
    res.json({
      active: false,
      sessionName,
      workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
      planningCompleted: false,
      error: error.message,
    });
  }
});

// Send message to planning session - sends input to the EXISTING interactive session
// This keeps the Claude session alive for back-and-forth conversation
app.post('/api/planning/:issueId/message', async (req, res) => {
  const { issueId } = req.params;
  const { message } = req.body;
  const sessionName = `planning-${issueId.toLowerCase()}`;
  const issueLower = issueId.toLowerCase();

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Find planning directory and workspace - check workspace first, then legacy
    const githubCheck = isGitHubIssue(issueId);
    let projectPath = '';
    let planningDir = '';
    let workspacePath = '';

    // Determine project path
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    } else {
      // Linear issue - check common paths
      const possiblePaths = [
        join(homedir(), 'projects', 'panopticon'),
        join(homedir(), 'projects', 'myn'),
      ];
      for (const p of possiblePaths) {
        // Check workspace first
        if (existsSync(join(p, 'workspaces', `feature-${issueLower}`, '.planning'))) {
          projectPath = p;
          break;
        }
        // Then legacy
        if (existsSync(join(p, '.planning', issueLower))) {
          projectPath = p;
          break;
        }
      }
    }

    if (!projectPath) {
      return res.status(404).json({ error: 'Could not find project path' });
    }

    // Check workspace planning first (git-backed)
    workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const workspacePlanningDir = join(workspacePath, '.planning');
    const legacyPlanningDir = join(projectPath, '.planning', issueLower);

    if (existsSync(workspacePlanningDir)) {
      planningDir = workspacePlanningDir;
    } else if (existsSync(legacyPlanningDir)) {
      planningDir = legacyPlanningDir;
    } else {
      return res.status(404).json({ error: 'Planning directory not found', sessionEnded: true });
    }

    // Check if agent state file indicates remote session
    let isRemote = false;
    let vmName = '';
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
    const stateFile = join(agentStateDir, 'state.json');

    try {
      if (existsSync(stateFile)) {
        const stateContent = readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(stateContent);
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
        }
      }
    } catch (err) {
      // Ignore - will check locally
    }

    // Check if the session is still alive
    let sessionExists = false;
    if (isRemote && vmName) {
      try {
        const { stdout } = await execAsync(`ssh -A -o ConnectTimeout=5 ${vmName}.exe.xyz "tmux list-sessions -F '#{session_name}' 2>/dev/null || echo ''"`, { timeout: 10000 });
        const sessions = stdout.trim().split('\n').filter(Boolean);
        sessionExists = sessions.includes(sessionName);
      } catch (err) {
        console.log(`[planning message] SSH to ${vmName} failed:`, err);
      }
    } else {
      try {
        const { stdout: sessionsOutput } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""', {
          encoding: 'utf-8',
        });
        const sessions = sessionsOutput.trim().split('\n').filter(Boolean);
        sessionExists = sessions.includes(sessionName);
      } catch (e) {
        // No sessions
      }
    }

    // If session exists, send the message directly to it using tmux send-keys
    if (sessionExists) {
      // Write message to a temp file to avoid shell escaping issues
      const messageFile = join(planningDir, 'user-message.txt');
      writeFileSync(messageFile, message);

      if (isRemote && vmName) {
        // For remote sessions, we need to copy the message file and use send-keys
        // First, write to remote
        const exe = await import('../lib/exe.js');
        const remoteMessagePath = `/workspace/.planning/user-message.txt`;
        await exe.ssh(vmName, `mkdir -p /workspace/.planning && cat > ${remoteMessagePath} << 'PANOPTICON_MSG_EOF'
${message}
PANOPTICON_MSG_EOF`);

        // Send keys to remote tmux - type the message content
        // Use tmux load-buffer to safely handle special characters
        await exe.ssh(vmName, `tmux load-buffer ${remoteMessagePath} && tmux paste-buffer -t ${sessionName}`);
        await exe.ssh(vmName, `tmux send-keys -t ${sessionName} Enter`);
      } else {
        // Local session - use tmux send-keys with load-buffer for safe character handling
        await execAsync(`tmux load-buffer "${messageFile}"`, { encoding: 'utf-8' });
        await execAsync(`tmux paste-buffer -t ${sessionName}`, { encoding: 'utf-8' });
        await execAsync(`tmux send-keys -t ${sessionName} Enter`, { encoding: 'utf-8' });
      }

      res.json({ success: true, sessionName, message: 'Message sent to active session' });
      return;
    }

    // Session doesn't exist - need to restart it in INTERACTIVE mode (not --print)
    console.log(`[planning message] Session ${sessionName} not found, starting new interactive session`);

    // Read previous output to get context for continuation
    const outputFile = join(planningDir, 'output.jsonl');
    let conversationLog = '';
    if (existsSync(outputFile)) {
      const content = readFileSync(outputFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const logParts: string[] = [];

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          // Assistant messages (text and tool uses)
          if (json.type === 'assistant' && json.message?.content) {
            for (const block of json.message.content) {
              if (block.type === 'text') {
                logParts.push(`**Assistant:**\n${block.text}`);
              } else if (block.type === 'tool_use') {
                const input = block.input || {};
                // Skip reads of CONTINUATION_PROMPT.md
                if (block.name === 'Read' && input.file_path?.includes('CONTINUATION_PROMPT.md')) {
                  continue;
                }
                let toolInfo = `**Tool: ${block.name}**`;
                if (block.name === 'Read' && input.file_path) {
                  toolInfo += `\nFile: ${input.file_path}`;
                } else if (block.name === 'Bash' && input.command) {
                  toolInfo += `\nCommand: ${input.command.slice(0, 200)}${input.command.length > 200 ? '...' : ''}`;
                } else if (block.name === 'Grep' && input.pattern) {
                  toolInfo += `\nPattern: ${input.pattern}`;
                } else if (block.name === 'Task' && input.description) {
                  toolInfo += `\nTask: ${input.description}`;
                }
                logParts.push(toolInfo);
              }
            }
          }

          // Tool results
          if (json.type === 'user' && json.message?.content) {
            for (const block of json.message.content) {
              if (block.type === 'tool_result' && block.content) {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                if (resultText.includes('# Continuation of Planning Session:')) {
                  continue;
                }
                if (resultText.trim()) {
                  logParts.push(`**Tool Result:**\n\`\`\`\n${resultText}\n\`\`\``);
                }
              }
            }
          }
        } catch (e) {}
      }
      conversationLog = logParts.join('\n\n');
    }

    // Create continuation prompt
    const continuationPromptPath = join(planningDir, 'CONTINUATION_PROMPT.md');
    const continuationPrompt = `# Continuation of Planning Session: ${issueId.toUpperCase()}

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files
- Run implementation commands (npm install, docker, etc.)
- Create actual features or functionality

**YOU SHOULD ONLY:**
- Ask clarifying questions
- Explore the codebase to understand context
- Generate planning artifacts (STATE.md, Beads tasks via \`bd create\`, PRD at \`docs/prds/active/{issue-id}-plan.md\`)
- Present options and tradeoffs

---

## Previous Conversation

${conversationLog}

---

## User's Response

${message}

---

## Your Task

Continue the PLANNING session. Do NOT implement anything.
`;

    writeFileSync(continuationPromptPath, continuationPrompt);

    // Determine working directory
    const agentCwd = existsSync(workspacePath) ? workspacePath : projectPath;

    // Backup old output for the new session
    if (existsSync(outputFile)) {
      const backupPath = join(planningDir, `output-${Date.now()}.jsonl`);
      renameSync(outputFile, backupPath);
    }

    // Get planning agent model from settings and start INTERACTIVE session (no --print)
    const msgSettings = loadSettings();
    const msgPlanningModel = msgSettings.models.planning_agent;
    const msgAgentCmd = getAgentCommand(msgPlanningModel);
    const msgCmdWithArgs = msgAgentCmd.args.length > 0
      ? `${msgAgentCmd.command} ${msgAgentCmd.args.join(' ')} --dangerously-skip-permissions`
      : `${msgAgentCmd.command} --dangerously-skip-permissions`;

    // Create launcher script for safe prompt handling (same as initial planning start)
    const launcherScript = join(agentStateDir, 'continuation-launcher.sh');
    mkdirSync(agentStateDir, { recursive: true });

    writeFileSync(launcherScript, `#!/bin/bash
cd "${agentCwd}"
exec ${msgCmdWithArgs} "Please read the continuation prompt at ${continuationPromptPath} and continue the planning session."
`, { mode: 0o755 });

    await ensureTmuxRunning();
    await execAsync(`tmux new-session -d -s ${sessionName} "bash '${launcherScript}'"`, { encoding: 'utf-8' });

    // Resize window for Claude TUI
    try {
      await execAsync(`tmux resize-window -t ${sessionName} -x 200 -y 50 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // Ignore resize errors
    }

    res.json({ success: true, sessionName, message: 'Planning session restarted in interactive mode' });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
});

// Stop planning session (kills tmux session)
app.delete('/api/planning/:issueId', async (req, res) => {
  const { issueId } = req.params;
  const sessionName = `planning-${issueId.toLowerCase()}`;

  try {
    // Kill tmux session
    await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to stop planning: ' + error.message });
  }
});

// Remove "planning" label from GitHub issue
async function removeGitHubPlanningLabel(owner: string, repo: string, number: number): Promise<void> {
  const config = getGitHubConfig();
  if (!config) throw new Error('GitHub not configured');

  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/planning`, {
    method: 'DELETE',
    headers: {
      'Authorization': `token ${config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Panopticon-Dashboard',
    },
  });
}


// Abort planning - reverts state to Todo and kills session
app.post('/api/issues/:id/abort-planning', async (req, res) => {
  const { id } = req.params;
  const { deleteWorkspace } = req.body || {};

  try {
    // Check if this is a GitHub issue
    const githubCheck = isGitHubIssue(id);

    let revertedState = 'Todo';
    let issueIdentifier: string | undefined; // e.g., "MIN-665"
    let sessionName: string; // Will be set based on identifier

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      // GitHub: set identifier from the ID (which is like "PAN-123")
      issueIdentifier = id;
      sessionName = `planning-${id.toLowerCase()}`;

      // GitHub: remove "planning" label
      try {
        await removeGitHubPlanningLabel(githubCheck.owner, githubCheck.repo, githubCheck.number);
        revertedState = 'Todo (label removed)';
      } catch (err) {
        // Label might not exist, that's fine
        console.log('Could not remove planning label:', err);
      }
    } else {
      // Linear: move back to Todo state
      const apiKey = getLinearApiKey();
      if (apiKey) {
        // Fetch issue to get team and identifier
        const issueQuery = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              team { id }
            }
          }
        `;

        const issueResponse = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey,
          },
          body: JSON.stringify({ query: issueQuery, variables: { id } }),
        });
        const issueJson = await issueResponse.json();
        const issue = issueJson.data?.issue;

        if (issue) {
          // Store the issue identifier for workspace deletion and session name
          issueIdentifier = issue.identifier;
          sessionName = `planning-${issue.identifier.toLowerCase()}`;

          // Find "Todo" state for this team
          const statesQuery = `
            query GetTeamStates($teamId: String!) {
              team(id: $teamId) {
                states {
                  nodes {
                    id
                    name
                    type
                  }
                }
              }
            }
          `;

          const statesResponse = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey,
            },
            body: JSON.stringify({ query: statesQuery, variables: { teamId: issue.team.id } }),
          });
          const statesJson = await statesResponse.json();
          const states = statesJson.data?.team?.states?.nodes || [];

          // Find Todo/Unstarted state
          const todoState = states.find((s: any) =>
            s.name.toLowerCase() === 'todo' ||
            s.name.toLowerCase() === 'to do' ||
            s.type === 'unstarted'
          );

          if (todoState) {
            // Move issue to Todo
            const updateMutation = `
              mutation UpdateIssue($id: String!, $stateId: String!) {
                issueUpdate(id: $id, input: { stateId: $stateId }) {
                  success
                  issue { state { name } }
                }
              }
            `;

            await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey,
              },
              body: JSON.stringify({
                query: updateMutation,
                variables: { id: issue.id, stateId: todoState.id },
              }),
            });
            revertedState = todoState.name;
          }
        }
      }
    }

    // Kill the tmux session (try both possible session names if needed)
    if (sessionName) {
      await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });
    }
    // Also try with UUID-based session name (fallback)
    await execAsync(`tmux kill-session -t planning-${id.toLowerCase()} 2>/dev/null || true`, { encoding: 'utf-8' });

    // Clean up agent state files to prevent stale "running" status
    // Note: issueIdentifier is the human-readable ID (e.g., "MIN-665"), not the Linear UUID
    const agentStateDir = sessionName ? join(homedir(), '.panopticon', 'agents', sessionName) : null;
    const workAgentStateDir = issueIdentifier
      ? join(homedir(), '.panopticon', 'agents', `agent-${issueIdentifier.toLowerCase()}`)
      : join(homedir(), '.panopticon', 'agents', `agent-${id.toLowerCase()}`);

    console.log(`[abort-planning] Cleanup paths: sessionName=${sessionName}, issueIdentifier=${issueIdentifier}`);
    console.log(`[abort-planning] agentStateDir=${agentStateDir}, exists=${agentStateDir ? existsSync(agentStateDir) : 'null'}`);
    console.log(`[abort-planning] workAgentStateDir=${workAgentStateDir}, exists=${existsSync(workAgentStateDir)}`);

    try {
      if (agentStateDir && existsSync(agentStateDir)) {
        rmSync(agentStateDir, { recursive: true, force: true });
        console.log(`[abort-planning] ✓ Cleaned up planning agent state: ${agentStateDir}`);
      }
      if (existsSync(workAgentStateDir)) {
        rmSync(workAgentStateDir, { recursive: true, force: true });
        console.log(`[abort-planning] ✓ Cleaned up work agent state: ${workAgentStateDir}`);
      }
    } catch (cleanupErr) {
      console.log('[abort-planning] Warning: Could not clean up agent state:', cleanupErr);
    }

    // Clean up legacy planning directory (outside workspace, in project root)
    // This exists when planning started before workspace creation or workspace was skipped
    if (issueIdentifier) {
      try {
        // Find project path to locate legacy planning dir
        let projectPath: string | undefined;
        const prefix = issueIdentifier.split('-')[0].toUpperCase();

        // For GitHub issues, use GitHub local paths
        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
        }

        // For Linear issues or if GitHub path not found, check projects.yaml
        if (!projectPath) {
          const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');
          if (existsSync(projectsYamlPath)) {
            const yaml = await import('js-yaml');
            const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
            for (const [, config] of Object.entries(projectsConfig.projects || {})) {
              const projConfig = config as any;
              // Check for Linear team match
              if (projConfig.linear_team?.toUpperCase() === prefix) {
                projectPath = projConfig.path;
                break;
              }
              // Check for GitHub issue_tracker with matching prefix (for PAN-* etc.)
              if (projConfig.issue_tracker === 'github' && projConfig.repo) {
                // Match by checking if the repo config uses this prefix
                const repoPrefix = projConfig.repo.split('/')[1]?.toUpperCase().slice(0, 3);
                if (prefix === 'PAN' && projConfig.repo.includes('panopticon')) {
                  projectPath = projConfig.path;
                  break;
                }
              }
            }
          }
        }

        if (projectPath) {
          const legacyPlanningDir = join(projectPath, '.planning', issueIdentifier.toLowerCase());
          if (existsSync(legacyPlanningDir)) {
            rmSync(legacyPlanningDir, { recursive: true, force: true });
            console.log(`[abort-planning] ✓ Cleaned up legacy planning dir: ${legacyPlanningDir}`);
          }
        }
      } catch (planningCleanupErr) {
        console.log('[abort-planning] Warning: Could not clean up legacy planning dir:', planningCleanupErr);
      }
    }

    // Optionally delete the workspace
    let workspaceDeleted = false;
    let workspaceError: string | undefined;

    if (deleteWorkspace) {
      try {
        // Find the workspace path - check GitHub or Linear project mapping
        let projectPath: string | undefined;

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
        } else if (issueIdentifier) {
          // For Linear issues, use the identifier to find the project path
          // Check project mappings
          const mappingsPath = join(homedir(), '.panopticon', 'project-mappings.json');
          if (existsSync(mappingsPath)) {
            const mappings = JSON.parse(readFileSync(mappingsPath, 'utf-8'));
            // Try to match by issue prefix (e.g., MIN-123 -> MIN)
            const prefix = issueIdentifier.split('-')[0];
            const mapping = mappings.find((m: any) => m.linearPrefix?.toUpperCase() === prefix.toUpperCase());
            if (mapping) {
              projectPath = mapping.localPath;
            }
          }

          // Also check projects.yaml
          if (!projectPath) {
            const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');
            if (existsSync(projectsYamlPath)) {
              try {
                const yaml = await import('js-yaml');
                const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
                const prefix = issueIdentifier.split('-')[0].toUpperCase();

                for (const [, config] of Object.entries(projectsConfig.projects || {})) {
                  const projConfig = config as any;
                  if (projConfig.linear_team?.toUpperCase() === prefix) {
                    projectPath = projConfig.path;
                    break;
                  }
                }
              } catch {
                // Ignore YAML errors
              }
            }
          }
        }

        if (projectPath && issueIdentifier) {
          // Try both naming conventions: feature-{identifier} and just {identifier}
          const featureWorkspacePath = join(projectPath, 'workspaces', `feature-${issueIdentifier.toLowerCase()}`);
          const plainWorkspacePath = join(projectPath, 'workspaces', issueIdentifier.toLowerCase());
          const workspacePath = existsSync(featureWorkspacePath) ? featureWorkspacePath : plainWorkspacePath;

          if (existsSync(workspacePath)) {
            // Check for custom workspace_remove_command in projects.yaml
            const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');
            let customRemoveCmd: string | undefined;

            if (existsSync(projectsYamlPath)) {
              try {
                const yaml = await import('js-yaml');
                const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
                const prefix = issueIdentifier.split('-')[0].toLowerCase();

                // Find project by linear_team prefix
                for (const [, config] of Object.entries(projectsConfig.projects || {})) {
                  const projConfig = config as any;
                  if (projConfig.linear_team?.toLowerCase() === prefix && projConfig.workspace_remove_command) {
                    customRemoveCmd = projConfig.workspace_remove_command;
                    break;
                  }
                }
              } catch (yamlErr) {
                console.log('Could not parse projects.yaml:', yamlErr);
              }
            }

            if (customRemoveCmd) {
              // Use custom remove command (legacy)
              const featureName = issueIdentifier.toLowerCase();
              await execAsync(`${customRemoveCmd} ${featureName}`, {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 60000, // 1 minute timeout
              });
              workspaceDeleted = true;
            } else {
              // Use pan workspace destroy command (handles polyrepo, Docker cleanup, etc.)
              const featureName = issueIdentifier.toLowerCase();
              await execAsync(`pan workspace destroy ${featureName} --force`, {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 120000, // 2 minute timeout for Docker cleanup
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer for verbose Docker output
              });
              workspaceDeleted = true;
            }
          } else {
            workspaceError = 'Workspace not found';
          }
        } else {
          workspaceError = 'Could not determine project path';
        }
      } catch (err: any) {
        workspaceError = err.message;
        console.error('Error deleting workspace:', err);
      }
    }

    res.json({
      success: true,
      issueId: id,
      revertedState,
      sessionKilled: true,
      workspaceDeleted,
      workspacePreserved: !deleteWorkspace && !workspaceDeleted,
      workspaceError,
    });
  } catch (error: any) {
    console.error('Error aborting planning:', error);
    res.status(500).json({ error: 'Failed to abort planning: ' + error.message });
  }
});

// Complete planning - move issue to "Planned" state
app.post('/api/issues/:id/complete-planning', async (req, res) => {
  const { id } = req.params;
  const sessionName = `planning-${id.toLowerCase()}`;
  const issueLower = id.toLowerCase();

  try {
    // Check if this was a remote planning session
    let isRemotePlanning = false;
    let remoteVmName: string | null = null;
    let remoteInfraVm: string | null = null;

    try {
      const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);

      // Check agent state.json for remote info
      const stateJsonPath = join(agentStateDir, 'state.json');
      if (existsSync(stateJsonPath)) {
        const agentState = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
        if (agentState.location === 'remote' && agentState.vmName) {
          isRemotePlanning = true;
          remoteVmName = agentState.vmName;
          remoteInfraVm = agentState.infraVm;
          console.log(`[complete-planning] Detected remote planning session on ${remoteVmName}`);
        }
      }

      // Also check legacy remote-workspace.json path
      if (!isRemotePlanning) {
        const remoteMetadataPath = join(agentStateDir, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          const remoteMetadata = JSON.parse(readFileSync(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) {
            isRemotePlanning = true;
            remoteVmName = remoteMetadata.vmName;
            remoteInfraVm = remoteMetadata.infraVm;
            console.log(`[complete-planning] Detected remote planning session on ${remoteVmName}`);
          }
        }
      }
    } catch (err) {
      // Not a remote session, continue with local flow
      console.log(`[complete-planning] Could not detect remote session: ${err}`);
    }

    // Kill any running planning session (local)
    try {
      await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
    } catch (e) {
      // Session might not exist
    }

    // Also kill remote session if applicable
    if (isRemotePlanning && remoteVmName) {
      try {
        const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
        const exe = createExeProvider({ infraVm: remoteInfraVm || undefined });
        await exe.ssh(remoteVmName, `tmux kill-session -t ${sessionName} 2>/dev/null || true`);
        console.log(`[complete-planning] Killed remote tmux session on ${remoteVmName}`);
      } catch (err) {
        console.log(`[complete-planning] Could not kill remote session: ${err}`);
      }
    }

    // Find planning directory and commit/push
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    let planningDir = '';

    // Determine project path
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    } else {
      // Linear issue - check common paths
      const possiblePaths = [
        join(homedir(), 'projects', 'panopticon'),
        join(homedir(), 'projects', 'myn'),
      ];
      for (const p of possiblePaths) {
        // Check workspace first
        if (existsSync(join(p, 'workspaces', `feature-${issueLower}`, '.planning'))) {
          projectPath = p;
          break;
        }
        // Then legacy
        if (existsSync(join(p, '.planning', issueLower))) {
          projectPath = p;
          break;
        }
      }
    }

    // For remote planning, sync beads from remote VM first
    let gitPushed = false;
    let beadsSynced = false;

    if (isRemotePlanning && remoteVmName) {
      console.log(`[complete-planning] Syncing beads from remote VM ${remoteVmName}...`);
      try {
        const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
        const exe = createExeProvider({ infraVm: remoteInfraVm || undefined });

        // Sync beads on remote (export to JSONL), commit, and push
        const syncResult = await exe.syncBeadsToGit(remoteVmName, '/workspace', `Complete planning for ${id}`);
        beadsSynced = syncResult;

        if (syncResult) {
          console.log(`[complete-planning] Remote beads synced and pushed`);

          // Now pull locally to get the changes
          if (projectPath) {
            const localGitRoot = join(projectPath, 'workspaces', `feature-${issueLower}`);
            if (existsSync(localGitRoot)) {
              console.log(`[complete-planning] Pulling remote changes to local workspace...`);
              try {
                await execAsync(`git pull --rebase`, { cwd: localGitRoot, encoding: 'utf-8', timeout: 30000 });
                console.log(`[complete-planning] Local workspace updated`);

                // Import beads locally
                try {
                  await execAsync(`bd sync --import 2>/dev/null || true`, { cwd: localGitRoot, encoding: 'utf-8', timeout: 10000 });
                  console.log(`[complete-planning] Local beads imported`);
                } catch (importErr) {
                  console.log(`[complete-planning] Beads import skipped (may not have local bd)`);
                }
              } catch (pullErr: any) {
                console.warn(`[complete-planning] Git pull failed: ${pullErr.message}`);
              }
            }
          }
          gitPushed = true; // Remote already pushed
        }
      } catch (remoteErr: any) {
        console.error(`[complete-planning] Remote sync failed: ${remoteErr.message}`);
        // Continue with local flow as fallback
      }
    }

    // Local git handling (for local planning or as fallback)
    if (projectPath && !gitPushed) {
      const workspacePlanningDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning');
      const legacyPlanningDir = join(projectPath, '.planning', issueLower);

      if (existsSync(workspacePlanningDir)) {
        planningDir = workspacePlanningDir;
      } else if (existsSync(legacyPlanningDir)) {
        planningDir = legacyPlanningDir;
      }

      if (planningDir) {
        try {
          // Get the git root (workspace or project root)
          const gitRoot = planningDir.includes('/workspaces/')
            ? join(projectPath, 'workspaces', `feature-${issueLower}`)
            : projectPath;

          // Run bd sync locally first to export beads to JSONL
          try {
            await execAsync(`bd sync 2>/dev/null || true`, { cwd: gitRoot, encoding: 'utf-8', timeout: 10000 });
          } catch (bdErr) {
            // bd might not be installed or .beads might not exist
          }

          // Git add planning and beads directories
          await execAsync(`git add .planning/`, { cwd: gitRoot, encoding: 'utf-8' });
          // Also add .beads/ if it exists (planning may create beads tasks)
          if (existsSync(join(gitRoot, '.beads'))) {
            await execAsync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' });
          }

          // Check if there are changes to commit
          try {
            await execAsync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' });
            // No changes to commit
          } catch (diffErr) {
            // There are changes, commit them
            await execAsync(`git commit -m "Complete planning for ${id}"`, { cwd: gitRoot, encoding: 'utf-8' });
          }

          // Push to remote (non-blocking to avoid freezing dashboard)
          // Spawn in background - don't await
          const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
          pushChild.unref();
          gitPushed = true;
          console.log(`[complete-planning] Git push started in background for ${id}`);
        } catch (gitErr) {
          console.error('Git commit/push failed:', gitErr);
          // Continue even if git fails
        }
      }
    }

    // Update issue state (Linear or GitHub)
    let newState = 'Planned';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      // GitHub: Remove "planning" label, add "planned" label
      const config = getGitHubConfig();
      if (config) {
        try {
          // Remove planning label
          await fetch(`https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/planning`, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${config.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Panopticon-Dashboard',
            },
          });
        } catch (e) {}

        try {
          // Add planned label
          await fetch(`https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${config.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Panopticon-Dashboard',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ labels: ['planned'] }),
          });
        } catch (e) {}
      }
    } else {
      // Linear: Update to "Planned" state
      const apiKey = getLinearApiKey();
      if (apiKey) {
        // First, get the issue to find its team
        const issueQuery = `query { issue(id: "${id}") { id team { id states { nodes { id name } } } } }`;
        const issueRes = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey,
          },
          body: JSON.stringify({ query: issueQuery }),
        });
        const issueData = await issueRes.json();
        const issue = issueData.data?.issue;

        if (issue) {
          // Find "Planned" state or fall back to first available state after "In Planning"
          const states = issue.team?.states?.nodes || [];
          let plannedState = states.find((s: any) => s.name === 'Planned');
          if (!plannedState) {
            plannedState = states.find((s: any) => s.name === 'Ready');
          }
          if (!plannedState) {
            plannedState = states.find((s: any) => s.name === 'Todo');
          }

          if (plannedState) {
            const updateMutation = `mutation { issueUpdate(id: "${issue.id}", input: { stateId: "${plannedState.id}" }) { success issue { state { name } } } }`;
            const updateRes = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey,
              },
              body: JSON.stringify({ query: updateMutation }),
            });
            const updateData = await updateRes.json();
            newState = updateData.data?.issueUpdate?.issue?.state?.name || 'Planned';
          }
        }
      }
    }

    res.json({
      success: true,
      issueId: id,
      newState,
      gitPushed,
      message: gitPushed
        ? 'Planning complete and pushed to git - ready for execution'
        : 'Planning complete - ready for execution',
    });
  } catch (error: any) {
    console.error('Error completing planning:', error);
    res.status(500).json({ error: 'Failed to complete planning: ' + error.message });
  }
});

// Reset an issue - kills agents (local+remote), resets Linear status to Todo
app.post('/api/issues/:id/reset', async (req, res) => {
  const { id } = req.params;
  const cleanupLog: string[] = [];

  try {
    const issueLower = id.toLowerCase();

    // 1. Kill local tmux sessions
    const localSessions = [`planning-${issueLower}`, `agent-${issueLower}`];
    for (const session of localSessions) {
      try {
        await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
        cleanupLog.push(`Killed local tmux: ${session}`);
      } catch {
        // Session might not exist
      }
    }

    // 2. Check for remote session and kill it
    const agentStateDir = join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`);
    const stateFile = join(agentStateDir, 'state.json');
    let vmName = '';

    try {
      if (existsSync(stateFile)) {
        const stateContent = readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(stateContent);
        if (state.location === 'remote' && state.vmName) {
          vmName = state.vmName;
        }
      }
    } catch {
      // No state file, try to detect from session name patterns
    }

    // If no state file, try common exe.dev VM patterns
    if (!vmName) {
      const vmPatterns = [`pan-${issueLower}-ws`, `pan-${id.replace('-', '-')}-ws`];
      for (const pattern of vmPatterns) {
        try {
          await execAsync(`ssh ${pattern}.exe.xyz "echo ok" 2>/dev/null`, { timeout: 5000 });
          vmName = pattern;
          break;
        } catch {
          // VM doesn't exist or not accessible
        }
      }
    }

    // Kill remote sessions
    if (vmName) {
      for (const session of localSessions) {
        try {
          await execAsync(`ssh ${vmName}.exe.xyz "tmux kill-session -t ${session}" 2>/dev/null || true`, { timeout: 10000 });
          cleanupLog.push(`Killed remote tmux on ${vmName}: ${session}`);
        } catch {
          // Session might not exist
        }
      }
    }

    // 3. Clean up agent state directories
    const agentDirs = [
      join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`),
      join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`),
    ];
    for (const dir of agentDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        cleanupLog.push(`Deleted agent state: ${dir}`);
      }
    }

    // 4. Clear shadow state
    try {
      const { removeShadowState } = await import('../../lib/shadow-state.js');
      const shadowResult = removeShadowState(id);
      if (shadowResult.success) {
        cleanupLog.push(`Cleared shadow state for ${id}`);
      }
    } catch {
      // Shadow state might not exist
    }

    // 5. Reset issue status to Todo/Open
    const githubCheck = isGitHubIssue(id);

    // Handle GitHub issues
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const ghConfig = getGitHubConfig();
      if (ghConfig) {
        const labelsToRemove = ['in-progress', 'planning', 'planned', 'review-ready'];
        for (const label of labelsToRemove) {
          try {
            await fetch(`https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/${encodeURIComponent(label)}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `token ${ghConfig.token}`,
                'Accept': 'application/vnd.github.v3+json',
              },
            });
            cleanupLog.push(`Removed GitHub label: ${label}`);
          } catch {
            // Label might not exist
          }
        }
      }
    }

    // Handle Linear issues
    if (!githubCheck.isGitHub && LINEAR_API_KEY) {
      const linearClient = new LinearClient({ apiKey: LINEAR_API_KEY });
      const [teamKey] = id.split('-');

      // Find the team and its Todo state
      const teams = await linearClient.teams();
      const team = teams.nodes.find(t => t.key.toLowerCase() === teamKey.toLowerCase());

      if (team) {
        const states = await team.states();
        const todoState = states.nodes.find(s => s.type === 'unstarted' && s.name.toLowerCase().includes('todo'));

        if (todoState) {
          // Find the issue
          const issues = await linearClient.issues({
            filter: { identifier: { eq: id.toUpperCase() } }
          });
          const issue = issues.nodes[0];

          if (issue) {
            await issue.update({ stateId: todoState.id });
            cleanupLog.push(`Reset Linear status to: ${todoState.name}`);
          }
        }
      }
    }

    res.json({ success: true, cleanupLog });

    // Invalidate all tracker caches after reset
    issueDataService.invalidateTracker('github').catch(() => {});
    issueDataService.invalidateTracker('linear').catch(() => {});
  } catch (error) {
    console.error('Reset failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      cleanupLog
    });
  }
});

// Reopen a done/closed issue - moves back to Backlog and optionally starts planning
app.post('/api/issues/:id/reopen', async (req, res) => {
  const { id } = req.params;
  const { skipPlan = false } = req.body || {};

  try {
    // Check if it's a Linear issue
    const linearKey = process.env.LINEAR_API_KEY || '';
    if (!linearKey) {
      return res.status(400).json({ error: 'LINEAR_API_KEY not configured' });
    }

    // Import Linear SDK
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey: linearKey });

    // Find the issue by identifier (e.g., "MIN-665")
    // Linear SDK accepts both UUIDs and identifiers
    const issue = await client.issue(id);

    if (!issue) {
      return res.status(404).json({ error: `Issue ${id} not found` });
    }

    // Get backlog state
    const team = await issue.team;
    if (!team) {
      return res.status(400).json({ error: 'Could not determine team for issue' });
    }

    const states = await team.states();
    const backlogState = states.nodes.find(s => s.type === 'backlog');

    if (!backlogState) {
      return res.status(400).json({ error: 'Could not find Backlog state for team' });
    }

    // Move issue to Backlog
    await issue.update({ stateId: backlogState.id });

    console.log(`Reopened issue ${id} - moved to Backlog`);

    // Optionally start planning
    if (!skipPlan) {
      // We could trigger planning here, but for now just return success
      // The user can click Plan from the dashboard
    }

    res.json({
      success: true,
      message: `Issue ${id} reopened and moved to Backlog`,
      issueId: issue.identifier,
      newState: 'Backlog',
    });

    // Invalidate Linear cache after reopen
    issueDataService.invalidateTracker('linear').catch(() => {});
  } catch (error: any) {
    console.error('Error reopening issue:', error);
    res.status(500).json({ error: 'Failed to reopen issue: ' + error.message });
  }
});

// Move an issue to a new status - supports both shadow state and tracker sync
app.post('/api/issues/:id/move-status', async (req, res) => {
  const { id } = req.params;
  const { targetStatus, syncToTracker = false } = req.body || {};

  // Validate targetStatus (CanonicalState)
  const validStatuses = ['backlog', 'todo', 'planning', 'in_progress', 'in_review', 'done'];
  if (!targetStatus || !validStatuses.includes(targetStatus)) {
    return res.status(400).json({ error: `Invalid targetStatus. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    // Import shadow state module
    const { updateShadowState } = await import('../../lib/shadow-state.js');

    // Map CanonicalState to IssueState for shadow state
    const canonicalToIssueState: Record<string, 'open' | 'in_progress' | 'closed'> = {
      backlog: 'open',
      todo: 'open',
      planning: 'in_progress',
      in_progress: 'in_progress',
      in_review: 'in_progress',
      done: 'closed',
    };

    const issueState = canonicalToIssueState[targetStatus];

    // Update shadow state first (always) - include targetCanonicalState for column placement
    const shadowResult = await updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus);

    // If syncToTracker is true and it's a Linear issue, also update Linear
    if (syncToTracker) {
      const linearKey = process.env.LINEAR_API_KEY || '';
      if (!linearKey) {
        return res.status(400).json({ error: 'LINEAR_API_KEY not configured for sync' });
      }

      // Check if it's a GitHub issue (skip Linear sync for those)
      const githubCheck = isGitHubIssue(id);
      if (githubCheck.isGitHub) {
        // GitHub issues don't support sync to tracker in this implementation
        console.log(`GitHub issue ${id} - skipping tracker sync`);
      } else {
        // Import Linear SDK
        const { LinearClient } = await import('@linear/sdk');
        const client = new LinearClient({ apiKey: linearKey });

        // Find the issue by identifier
        const issue = await client.issue(id);

        if (!issue) {
          return res.status(404).json({ error: `Issue ${id} not found in Linear` });
        }

        // Get team states to find the target state
        const team = await issue.team;
        if (!team) {
          return res.status(400).json({ error: 'Could not determine team for issue' });
        }

        const states = await team.states();

        // Map canonical state to Linear state type
        const stateTypeMap: Record<string, string> = {
          backlog: 'backlog',
          todo: 'unstarted',
          planning: 'started',
          in_progress: 'started',
          in_review: 'started',
          done: 'completed',
        };

        const targetStateType = stateTypeMap[targetStatus];

        // Find the first matching state for the target type
        const targetState = states.nodes.find(s => s.type === targetStateType);

        if (!targetState) {
          return res.status(400).json({ error: `Could not find state of type '${targetStateType}' for team` });
        }

        // Update the issue state in Linear
        await issue.update({ stateId: targetState.id });
        console.log(`Synced issue ${id} to Linear state: ${targetState.name}`);
      }
    }

    res.json({
      success: true,
      message: `Issue ${id} moved to ${targetStatus}`,
      issueId: id,
      newStatus: targetStatus,
      syncToTracker,
      shadowState: shadowResult,
    });

    // Invalidate cache and push updated issues to all clients
    const githubMoveCheck = isGitHubIssue(id);
    if (githubMoveCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }
  } catch (error: any) {
    console.error('Error moving issue status:', error);
    res.status(500).json({ error: 'Failed to move issue status: ' + error.message });
  }
});

// Cleanup workspace for an issue (delete workspace directory and git worktree)
app.post('/api/issues/:id/cleanup-workspace', async (req, res) => {
  const { id } = req.params;
  const cleanupLog: string[] = [];

  try {
    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);

    // Find the workspace path
    let projectRoot: string | null = null;
    if (githubCheck.isGitHub) {
      const localPaths = getGitHubLocalPaths();
      const repoKey = `${githubCheck.owner}/${githubCheck.repo}`;
      projectRoot = localPaths[repoKey] || null;
    }
    // TODO: Add Linear project path resolution

    if (projectRoot) {
      const workspacePath = join(projectRoot, 'workspaces', `feature-${issueLower}`);

      // Check if it's a git worktree
      try {
        const worktreeList = await execAsync(`git worktree list --porcelain`, { cwd: projectRoot, encoding: 'utf-8' });
        if (worktreeList.stdout.includes(workspacePath)) {
          // It's a proper worktree - remove it
          await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectRoot, encoding: 'utf-8' });
          cleanupLog.push(`Removed git worktree: ${workspacePath}`);
        } else if (existsSync(workspacePath)) {
          // Just a directory - remove it
          await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
          cleanupLog.push(`Removed directory: ${workspacePath}`);
        }
      } catch (e) {
        // Try simple removal if worktree commands fail
        if (existsSync(workspacePath)) {
          await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
          cleanupLog.push(`Removed directory: ${workspacePath}`);
        }
      }

      // Also remove feature branch if it exists
      const branchName = `feature/${issueLower}`;
      try {
        await execAsync(`git branch -D "${branchName}" 2>/dev/null || true`, { cwd: projectRoot, encoding: 'utf-8' });
        cleanupLog.push(`Deleted local branch: ${branchName}`);
      } catch {
        // Branch might not exist
      }
    }

    // Clean up agent state directory
    const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
    if (existsSync(agentDir)) {
      await execAsync(`rm -rf "${agentDir}"`, { encoding: 'utf-8' });
      cleanupLog.push(`Removed agent state: ${agentDir}`);
    }

    res.json({
      success: true,
      message: `Workspace cleaned up for ${id}`,
      cleanupLog,
    });
  } catch (error: any) {
    console.error('Error cleaning up workspace:', error);
    res.status(500).json({ error: 'Failed to cleanup workspace: ' + error.message, cleanupLog });
  }
});

// Deep wipe - completely clean up all state for an issue
app.post('/api/issues/:id/deep-wipe', async (req, res) => {
  const { id } = req.params;
  const { deleteWorkspace = false } = req.body || {};
  const cleanupLog: string[] = [];

  try {
    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);

    // 1. Kill all tmux sessions for this issue
    const sessionPatterns = [
      `planning-${issueLower}`,
      `agent-${issueLower}`,
    ];
    for (const session of sessionPatterns) {
      try {
        await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`, { encoding: 'utf-8' });
        cleanupLog.push(`Killed tmux session: ${session}`);
      } catch (e) {
        // Session might not exist
      }
    }

    // 2. Clean up agent state directories
    const agentDirs = [
      join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`),
      join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`),
    ];
    for (const dir of agentDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        cleanupLog.push(`Deleted agent state: ${dir}`);
      }
    }

    // 2.5 Clear shadow state for this issue
    try {
      const { removeShadowState } = await import('../../lib/shadow-state.js');
      const shadowResult = removeShadowState(id);
      if (shadowResult.success) {
        cleanupLog.push(`Cleared shadow state for ${id}`);
      }
    } catch (shadowErr) {
      // Shadow state might not exist, that's fine
    }

    // 3. Find project path for workspace and planning dir cleanup
    let projectPath: string | undefined;
    if (!githubCheck.isGitHub) {
      const prefix = id.split('-')[0].toUpperCase();
      const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');
      if (existsSync(projectsYamlPath)) {
        const yaml = await import('js-yaml');
        const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
        for (const [, config] of Object.entries(projectsConfig.projects || {})) {
          const projConfig = config as any;
          if (projConfig.linear_team?.toUpperCase() === prefix) {
            projectPath = projConfig.path;
            break;
          }
        }
      }
    } else {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
    }

    // 4. Clean up legacy planning directory
    if (projectPath) {
      const legacyPlanningDir = join(projectPath, '.planning', issueLower);
      if (existsSync(legacyPlanningDir)) {
        rmSync(legacyPlanningDir, { recursive: true, force: true });
        cleanupLog.push(`Deleted legacy planning dir: ${legacyPlanningDir}`);
      }
    }

    // 5. Optionally delete workspace
    if (deleteWorkspace && projectPath) {
      const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
      const branchName = `feature/${issueLower}`;
      const gitDirs = ['api', 'frontend', 'fe', '.'];

      // Helper to run git commands with timeout (5 seconds for local, 10 for remote)
      const gitExec = async (cmd: string, timeoutMs = 5000) => {
        try {
          await execAsync(cmd, { encoding: 'utf-8', timeout: timeoutMs });
        } catch (e) {
          // Command failed or timed out - continue anyway
        }
      };

      // Remove git worktrees first
      for (const gitDir of gitDirs) {
        const gitPath = join(projectPath, gitDir);
        if (existsSync(join(gitPath, '.git'))) {
          // Remove worktree - use prune instead of remove to avoid hangs
          await gitExec(`cd "${gitPath}" && git worktree prune 2>/dev/null || true`);

          // Also try explicit remove for subdirs
          const subDirs = ['fe', 'api', 'frontend'];
          for (const subDir of subDirs) {
            const subPath = join(workspacePath, subDir);
            await gitExec(`cd "${gitPath}" && git worktree remove "${subPath}" --force 2>/dev/null || true`);
          }

          // Delete local branch
          await gitExec(`cd "${gitPath}" && git branch -D "${branchName}" 2>/dev/null || true`);

          // Delete remote branch (longer timeout for network)
          await gitExec(`cd "${gitPath}" && git push origin --delete "${branchName}" 2>/dev/null || true`, 10000);
        }
      }

      // Delete workspace directory if it still exists
      if (existsSync(workspacePath)) {
        rmSync(workspacePath, { recursive: true, force: true });
      }
      cleanupLog.push(`Deleted workspace and branches: ${branchName}`);
    }

    // 6. Reset issue state and remove labels (Linear or GitHub)
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      // GitHub: remove planning-related labels
      const config = getGitHubConfig();
      if (config) {
        const labelsToRemove = ['planning', 'planned', 'in-progress', 'review-ready'];
        for (const label of labelsToRemove) {
          try {
            await fetch(`https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/${label}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
              },
            });
            cleanupLog.push(`Removed GitHub label: ${label}`);
          } catch (e) {
            // Label might not exist, that's fine
          }
        }
      }
    } else {
      // Linear: reset state and remove labels
      const linearKey = process.env.LINEAR_API_KEY || '';
      if (linearKey) {
        try {
          const { LinearClient } = await import('@linear/sdk');
          const client = new LinearClient({ apiKey: linearKey });
          const issue = await client.issue(id);

          if (issue) {
            // Get team and Todo state
            const team = await issue.team;
            if (team) {
              const states = await team.states();
              // Find Todo/Unstarted state (same logic as abort-planning)
              const todoState = states.nodes.find(s =>
                s.name.toLowerCase() === 'todo' ||
                s.name.toLowerCase() === 'to do' ||
                s.type === 'unstarted'
              );

              if (todoState) {
                await issue.update({ stateId: todoState.id });
                cleanupLog.push(`Reset Linear status to ${todoState.name}`);
              }

              // Remove labels
              const labels = await issue.labels();
              const labelsToRemove = labels.nodes.filter(l =>
                l.name.toLowerCase() === 'review ready' ||
                l.name.toLowerCase() === 'planning'
              );
              if (labelsToRemove.length > 0) {
                const currentLabelIds = labels.nodes.map(l => l.id);
                const newLabelIds = currentLabelIds.filter(
                  lid => !labelsToRemove.some(lr => lr.id === lid)
                );
                await issue.update({ labelIds: newLabelIds });
                cleanupLog.push(`Removed labels: ${labelsToRemove.map(l => l.name).join(', ')}`);
              }
            }
          }
        } catch (linearErr) {
          cleanupLog.push(`Linear cleanup warning: ${(linearErr as Error).message}`);
        }
      }
    }

    console.log(`[deep-wipe] Completed for ${id}:`, cleanupLog);
    res.json({
      success: true,
      message: `Deep wipe completed for ${id}`,
      cleanupLog,
    });
  } catch (error: any) {
    console.error('Error in deep wipe:', error);
    res.status(500).json({ error: 'Deep wipe failed: ' + error.message, partialLog: cleanupLog });
  }
});

// Get beads tasks for an issue
app.get('/api/issues/:id/beads', async (req, res) => {
  const { id } = req.params;
  const issueLower = id.toLowerCase();

  try {
    // Find project path for workspace info
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    } else {
      const possiblePaths = [
        join(homedir(), 'projects', 'panopticon'),
        join(homedir(), 'projects', 'myn'),
      ];
      for (const p of possiblePaths) {
        if (existsSync(join(p, 'workspaces', `feature-${issueLower}`)) || existsSync(join(p, '.beads'))) {
          projectPath = p;
          break;
        }
      }
    }

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

    // Check if this is a remote workspace
    let isRemoteWorkspace = false;
    let remoteVmName: string | null = null;
    let remoteInfraVm: string | null = null;

    // Check agent state for remote metadata (for active planning sessions)
    const sessionName = `planning-${issueLower}`;
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);

    // First check state.json for remote info
    const stateJsonPath = join(agentStateDir, 'state.json');
    if (existsSync(stateJsonPath)) {
      try {
        const agentState = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
        if (agentState.location === 'remote' && agentState.vmName) {
          isRemoteWorkspace = true;
          remoteVmName = agentState.vmName;
          remoteInfraVm = agentState.infraVm;
        }
      } catch (err) {
        // Ignore parse errors
      }
    }

    // Also check legacy remote-workspace.json path
    if (!isRemoteWorkspace) {
      const remoteMetadataPath = join(agentStateDir, 'remote-workspace.json');
      if (existsSync(remoteMetadataPath)) {
        try {
          const remoteMetadata = JSON.parse(readFileSync(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) {
            isRemoteWorkspace = true;
            remoteVmName = remoteMetadata.vmName;
            remoteInfraVm = remoteMetadata.infraVm;
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    }

    // Also check workspace metadata file
    if (!isRemoteWorkspace) {
      try {
        const { loadWorkspaceMetadata } = await import('../../lib/remote/workspace-metadata.js');
        const wsMetadata = loadWorkspaceMetadata(id);
        if (wsMetadata?.vmName) {
          isRemoteWorkspace = true;
          remoteVmName = wsMetadata.vmName;
          remoteInfraVm = wsMetadata.infraVm;
        }
      } catch (err) {
        // Not a remote workspace
      }
    }

    let beads: any[] = [];
    let querySource = 'local';

    // Try remote query first if this is a remote workspace
    if (isRemoteWorkspace && remoteVmName) {
      try {
        const { createExeProvider } = await import('../../lib/remote/exe-provider.js');
        const exe = createExeProvider({ infraVm: remoteInfraVm || undefined });

        console.log(`[beads-api] Querying beads on remote VM ${remoteVmName} for ${id}`);
        beads = await exe.queryBeads(remoteVmName, id, '/workspace');
        querySource = 'remote';
        console.log(`[beads-api] Found ${beads.length} beads on remote`);
      } catch (remoteErr: any) {
        console.warn(`[beads-api] Remote query failed: ${remoteErr.message}, falling back to local`);
        // Fall through to local query
      }
    }

    // If no remote results, try local query
    if (beads.length === 0) {
      try {
        const { stdout } = await execAsync(`bd search "${id}" --json`, {
          cwd: projectPath || homedir(),
          encoding: 'utf-8',
          timeout: 10000,
        });

        beads = JSON.parse(stdout || '[]');
        querySource = 'local';
      } catch (bdError: any) {
        // bd command not found or failed
        console.error('bd search failed:', bdError.message);
      }
    }

    const tasks = beads.map((bead: any) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      type: bead.issue_type || bead.type || 'task',
      blockedBy: bead.blocked_by || [],
      createdAt: bead.created_at,
      labels: bead.labels || [],
      priority: bead.priority,
    }));

    // Sort by priority (P1 first) then by creation date
    tasks.sort((a: any, b: any) => {
      if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    res.json({
      tasks,
      workspacePath,
      count: tasks.length,
      source: querySource,
      isRemote: isRemoteWorkspace,
    });
  } catch (error: any) {
    console.error('Error fetching beads:', error);
    res.status(500).json({ error: 'Failed to fetch beads: ' + error.message });
  }
});

// ============== Cost & Metrics API ==============

// Cost tracking paths
const COSTS_DIR = join(homedir(), '.panopticon', 'costs');
const SESSION_MAP_FILE = join(homedir(), '.panopticon', 'session-map.json');
const METRICS_FILE = join(homedir(), '.panopticon', 'runtime-metrics.json');

function readCostFiles(startDate: string, endDate: string): any[] {
  const entries: any[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0];
    const costFile = join(COSTS_DIR, `costs-${dateStr}.jsonl`);

    if (existsSync(costFile)) {
      const content = readFileSync(costFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip invalid entries
        }
      }
    }
  }

  return entries;
}

function loadSessionMap(): any {
  try {
    if (existsSync(SESSION_MAP_FILE)) {
      return JSON.parse(readFileSync(SESSION_MAP_FILE, 'utf-8'));
    }
  } catch {}
  return { version: 1, issues: {}, lastUpdated: new Date().toISOString() };
}

function loadRuntimeMetrics(): any {
  try {
    if (existsSync(METRICS_FILE)) {
      return JSON.parse(readFileSync(METRICS_FILE, 'utf-8'));
    }
  } catch {}
  return { version: 1, tasks: [], runtimes: {}, lastUpdated: new Date().toISOString() };
}

function saveRuntimeMetrics(data: any): void {
  const { mkdirSync } = require('fs');
  mkdirSync(dirname(METRICS_FILE), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
}

// Parse Claude Code session files for a workspace and return aggregated usage (ASYNC to avoid blocking)
async function parseWorkspaceSessionUsageAsync(workspacePath: string): Promise<{
  tokenCount: number;
  cost: number;
  model: string;
  startTime: string | null;
  endTime: string | null;
}> {
  // Claude Code session directory name format: path with leading / removed and / replaced by -
  // e.g., /home/eltmon/projects/foo -> -home-eltmon-projects-foo
  const sessionDirName = `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`;
  const sessionDir = join(homedir(), '.claude', 'projects', sessionDirName);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let model = 'claude-sonnet-4';
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (!existsSync(sessionDir)) {
    console.log(`No session directory found: ${sessionDir}`);
    return { tokenCount: 0, cost: 0, model, startTime: null, endTime: null };
  }

  try {
    const allFiles = await readdir(sessionDir);
    const files = allFiles.filter(f => f.endsWith('.jsonl'));

    // Read files in parallel but with concurrency limit to avoid memory issues
    const BATCH_SIZE = 5;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const contents = await Promise.all(
        batch.map(async (file) => {
          const filePath = join(sessionDir, file);
          try {
            return await readFile(filePath, 'utf-8');
          } catch {
            return '';
          }
        })
      );

      for (const content of contents) {
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);

            // Track timestamps
            if (entry.timestamp) {
              if (!startTime || entry.timestamp < startTime) {
                startTime = entry.timestamp;
              }
              if (!endTime || entry.timestamp > endTime) {
                endTime = entry.timestamp;
              }
            }

            // Extract model
            if (entry.message?.model || entry.model) {
              model = entry.message?.model || entry.model;
            }

            // Extract usage - can be at top level or in message
            const usage = entry.usage || entry.message?.usage;
            if (usage) {
              totalInputTokens += usage.input_tokens || 0;
              totalOutputTokens += usage.output_tokens || 0;
              totalCacheReadTokens += usage.cache_read_input_tokens || 0;
              totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    // Calculate cost using centralized pricing
    const pricing = getPricing('anthropic', model);
    let cost = 0;

    if (pricing) {
      const usage: TokenUsage = {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheWriteTokens: totalCacheWriteTokens,
        cacheTTL: '5m',
      };
      cost = calculateCost(usage, pricing);
    } else {
      console.warn(`No pricing found for model: ${model}`);
    }

    const tokenCount = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens;

    console.log(`Parsed session usage for ${workspacePath}: ${tokenCount} tokens, $${cost.toFixed(4)}`);

    return { tokenCount, cost, model, startTime, endTime };
  } catch (err) {
    console.error('Error parsing session files:', err);
    return { tokenCount: 0, cost: 0, model, startTime: null, endTime: null };
  }
}

// Record a completed task in runtime metrics (async to avoid blocking)
async function recordApprovedTask(issueId: string, workspacePath: string, outcome: 'success' | 'failure' | 'partial'): Promise<void> {
  try {
    const usage = await parseWorkspaceSessionUsageAsync(workspacePath);
    const data = loadRuntimeMetrics();

    const startedAt = usage.startTime || new Date().toISOString();
    const completedAt = usage.endTime || new Date().toISOString();
    const durationMinutes = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000;

    // Determine capability from issue prefix or description
    let capability: string = 'feature';
    const issueLower = issueId.toLowerCase();
    if (issueLower.includes('bug') || issueLower.includes('fix')) {
      capability = 'bugfix';
    } else if (issueLower.includes('refactor')) {
      capability = 'refactor';
    } else if (issueLower.includes('doc')) {
      capability = 'documentation';
    } else if (issueLower.includes('test')) {
      capability = 'testing';
    } else if (issueLower.includes('review')) {
      capability = 'review';
    } else if (issueLower.includes('plan')) {
      capability = 'planning';
    }

    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runtime: 'claude',
      issueId,
      capability,
      model: usage.model,
      outcome,
      startedAt,
      completedAt,
      durationMinutes: Math.max(durationMinutes, 0),
      cost: usage.cost,
      tokenCount: usage.tokenCount,
    };

    data.tasks.push(task);

    // Rebuild runtime aggregates
    const runtimeTasks = data.tasks.filter((t: any) => t.runtime === 'claude');
    const successful = runtimeTasks.filter((t: any) => t.outcome === 'success').length;
    const failed = runtimeTasks.filter((t: any) => t.outcome === 'failure').length;
    const partial = runtimeTasks.filter((t: any) => t.outcome === 'partial').length;
    const totalCost = runtimeTasks.reduce((sum: number, t: any) => sum + (t.cost || 0), 0);
    const totalTokens = runtimeTasks.reduce((sum: number, t: any) => sum + (t.tokenCount || 0), 0);
    const totalDuration = runtimeTasks.reduce((sum: number, t: any) => sum + (t.durationMinutes || 0), 0);

    // By capability aggregation
    const byCapability: any = {};
    const capabilities = ['feature', 'bugfix', 'refactor', 'review', 'planning', 'documentation', 'testing', 'other'];
    for (const cap of capabilities) {
      const capTasks = runtimeTasks.filter((t: any) => t.capability === cap);
      if (capTasks.length > 0) {
        const capSuccessful = capTasks.filter((t: any) => t.outcome === 'success').length;
        const capTotalCost = capTasks.reduce((sum: number, t: any) => sum + (t.cost || 0), 0);
        const capTotalDuration = capTasks.reduce((sum: number, t: any) => sum + (t.durationMinutes || 0), 0);
        byCapability[cap] = {
          tasks: capTasks.length,
          successfulTasks: capSuccessful,
          successRate: capTasks.length > 0 ? capSuccessful / capTasks.length : 0,
          avgDurationMinutes: capTasks.length > 0 ? capTotalDuration / capTasks.length : 0,
          totalCost: capTotalCost,
          avgCost: capTasks.length > 0 ? capTotalCost / capTasks.length : 0,
        };
      }
    }

    // By model aggregation
    const byModel: any = {};
    const models: string[] = [...new Set(runtimeTasks.map((t: any) => t.model || 'unknown'))] as string[];
    for (const m of models) {
      const modelTasks = runtimeTasks.filter((t: any) => (t.model || 'unknown') === m);
      const modelSuccessful = modelTasks.filter((t: any) => t.outcome === 'success').length;
      const modelTotalCost = modelTasks.reduce((sum: number, t: any) => sum + (t.cost || 0), 0);
      byModel[m] = {
        tasks: modelTasks.length,
        successRate: modelTasks.length > 0 ? modelSuccessful / modelTasks.length : 0,
        avgCost: modelTasks.length > 0 ? modelTotalCost / modelTasks.length : 0,
        totalCost: modelTotalCost,
      };
    }

    // Daily stats
    const dailyStats: any[] = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    for (let d = new Date(thirtyDaysAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayTasks = runtimeTasks.filter((t: any) => t.completedAt?.startsWith(dateStr));
      if (dayTasks.length > 0) {
        const daySuccessful = dayTasks.filter((t: any) => t.outcome === 'success').length;
        const dayCost = dayTasks.reduce((sum: number, t: any) => sum + (t.cost || 0), 0);
        const dayTokens = dayTasks.reduce((sum: number, t: any) => sum + (t.tokenCount || 0), 0);
        dailyStats.push({
          date: dateStr,
          tasks: dayTasks.length,
          successfulTasks: daySuccessful,
          cost: dayCost,
          successRate: dayTasks.length > 0 ? daySuccessful / dayTasks.length : 0,
          tokenCount: dayTokens,
        });
      }
    }

    data.runtimes['claude'] = {
      runtime: 'claude',
      totalTasks: runtimeTasks.length,
      successfulTasks: successful,
      failedTasks: failed,
      partialTasks: partial,
      successRate: runtimeTasks.length > 0 ? successful / runtimeTasks.length : 0,
      avgDurationMinutes: runtimeTasks.length > 0 ? totalDuration / runtimeTasks.length : 0,
      avgCost: runtimeTasks.length > 0 ? totalCost / runtimeTasks.length : 0,
      totalCost,
      totalTokens,
      byCapability,
      byModel,
      dailyStats,
      lastUpdated: new Date().toISOString(),
    };

    saveRuntimeMetrics(data);
    console.log(`Recorded task for ${issueId}: ${outcome}, $${usage.cost.toFixed(4)}, ${usage.tokenCount} tokens`);
  } catch (err) {
    console.error('Error recording task metrics:', err);
  }
}

// GET /api/costs/summary - Overall cost summary
app.get('/api/costs/summary', (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const todayEntries = readCostFiles(today, today);
    const weekEntries = readCostFiles(weekAgo, today);
    const monthEntries = readCostFiles(monthAgo, today);

    const summarize = (entries: any[]) => ({
      totalCost: entries.reduce((sum, e) => sum + (e.cost || 0), 0),
      totalTokens: entries.reduce((sum, e) => sum + ((e.usage?.inputTokens || 0) + (e.usage?.outputTokens || 0)), 0),
      entryCount: entries.length,
      byModel: entries.reduce((acc, e) => {
        acc[e.model] = (acc[e.model] || 0) + (e.cost || 0);
        return acc;
      }, {} as Record<string, number>),
    });

    res.json({
      today: summarize(todayEntries),
      week: summarize(weekEntries),
      month: summarize(monthEntries),
    });
  } catch (error: any) {
    console.error('Error getting cost summary:', error);
    res.status(500).json({ error: 'Failed to get cost summary: ' + error.message });
  }
});

// GET /api/costs/by-issue - Costs grouped by issue (from event-sourced cache)
app.get('/api/costs/by-issue', async (_req, res) => {
  try {
    // Check if migration is needed and run it
    if (needsMigration()) {
      console.log('Running cost migration on first request...');
      const stats = migrateIfNeeded();
      if (stats) {
        console.log(`Migration complete: ${stats.eventsCreated} events created, ${stats.errors.length} errors`);
      }
    }

    // Sync cache with latest events (fast incremental update)
    const cache = syncCache();

    // Get cache status
    const cacheStatus = getCacheStatus();

    // Convert cache data to API response format
    const issues = Object.entries(cache.issues).map(([issueId, data]) => ({
      issueId,
      totalCost: data.totalCost,
      tokenCount: data.inputTokens + data.outputTokens + data.cacheReadTokens + data.cacheWriteTokens,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      // Legacy fields (keep for backward compatibility)
      models: data.models,
      providers: data.providers,
      // New per-model breakdown (PAN-105)
      byModel: Object.fromEntries(
        Object.entries(data.models).map(([model, stats]) => [
          model,
          { cost: stats.cost, tokens: stats.tokens }
        ])
      ),
      // New per-stage breakdown (PAN-105)
      byStage: Object.fromEntries(
        Object.entries(data.stages || {}).map(([stage, stats]) => [
          stage,
          { cost: stats.cost, tokens: stats.tokens }
        ])
      ),
      budget: data.budget,
      budgetWarning: data.budgetWarning,
      lastUpdated: data.lastUpdated,
    }));

    // Sort by cost descending
    issues.sort((a, b) => b.totalCost - a.totalCost);

    res.json({
      status: cacheStatus.status,
      lastEventTs: cacheStatus.lastEventTs,
      eventCount: cacheStatus.eventCount,
      issues,
    });
  } catch (error: any) {
    console.error('Error getting costs by issue:', error);
    res.status(500).json({ error: 'Failed to get costs by issue: ' + error.message });
  }
});

// POST /api/costs/rebuild - Force rebuild of cost cache from events
app.post('/api/costs/rebuild', async (_req, res) => {
  try {
    console.log('Manual cost cache rebuild requested...');

    // Run migration if needed
    const migrationStats = migrateAllSessions();

    // Rebuild cache
    const cache = rebuildCache();

    res.json({
      success: true,
      message: 'Cost cache rebuilt successfully',
      migration: {
        eventsCreated: migrationStats.eventsCreated,
        totalCost: migrationStats.totalCost,
        errors: migrationStats.errors.length,
        warnings: migrationStats.warnings.length,
      },
      cache: {
        issueCount: Object.keys(cache.issues).length,
        eventCount: cache.lastEventLine,
        lastEventTs: cache.lastEventTs,
      },
    });
  } catch (error: any) {
    console.error('Error rebuilding cost cache:', error);
    res.status(500).json({ error: 'Failed to rebuild cost cache: ' + error.message });
  }
});

// GET /api/costs/stream - Stream recent cost events for real-time updates
app.get('/api/costs/stream', (req, res) => {
  try {
    const { since, limit = 50 } = req.query;

    let events;
    if (since) {
      // Get events since a specific timestamp
      events = readEvents({
        startDate: since as string,
        limit: parseInt(limit as string, 10),
      });
    } else {
      // Get last N events
      events = tailEvents(parseInt(limit as string, 10));
    }

    // Group events by issue for easier consumption
    const byIssue: Record<string, any[]> = {};
    for (const event of events) {
      if (!byIssue[event.issueId]) {
        byIssue[event.issueId] = [];
      }
      byIssue[event.issueId].push({
        ts: event.ts,
        model: event.model,
        provider: event.provider,
        cost: event.cost,
        tokens: event.input + event.output + event.cacheRead + event.cacheWrite,
      });
    }

    res.json({
      events: events.slice(0, 50), // Limit to 50 most recent
      byIssue,
      count: events.length,
    });
  } catch (error: any) {
    console.error('Error streaming cost events:', error);
    res.status(500).json({ error: 'Failed to stream cost events: ' + error.message });
  }
});

// GET /api/issues/:id/costs - Cost summary for a specific issue (from event-sourced cache)
app.get('/api/issues/:id/costs', (req, res) => {
  try {
    const { id } = req.params;

    // Sync cache to get latest data
    syncCache();

    // Get costs for the issue
    const issueData = getCostsForIssue(id);

    if (!issueData) {
      return res.json({
        issueId: id.toUpperCase(),
        totalCost: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        // Legacy fields
        models: {},
        providers: {},
        // New per-model and per-stage breakdown (PAN-105)
        byModel: {},
        byStage: {},
        budget: undefined,
        budgetWarning: false,
      });
    }

    res.json({
      issueId: id.toUpperCase(),
      totalCost: issueData.totalCost,
      totalTokens: issueData.inputTokens + issueData.outputTokens + issueData.cacheReadTokens + issueData.cacheWriteTokens,
      inputTokens: issueData.inputTokens,
      outputTokens: issueData.outputTokens,
      cacheReadTokens: issueData.cacheReadTokens,
      cacheWriteTokens: issueData.cacheWriteTokens,
      // Legacy fields (keep for backward compatibility)
      models: issueData.models,
      providers: issueData.providers,
      // New per-model breakdown (PAN-105)
      byModel: Object.fromEntries(
        Object.entries(issueData.models).map(([model, stats]) => [
          model,
          { cost: stats.cost, tokens: stats.tokens }
        ])
      ),
      // New per-stage breakdown (PAN-105)
      byStage: Object.fromEntries(
        Object.entries(issueData.stages || {}).map(([stage, stats]) => [
          stage,
          { cost: stats.cost, tokens: stats.tokens }
        ])
      ),
      budget: issueData.budget,
      budgetWarning: issueData.budgetWarning,
      lastUpdated: issueData.lastUpdated,
    });
  } catch (error: any) {
    console.error('Error getting issue costs:', error);
    res.status(500).json({ error: 'Failed to get issue costs: ' + error.message });
  }
});

// GET /api/metrics/runtimes - Runtime metrics comparison
app.get('/api/metrics/runtimes', (_req, res) => {
  try {
    const metrics = loadRuntimeMetrics();
    const runtimes = metrics.runtimes || {};

    // Format for frontend
    const comparison = Object.entries(runtimes).map(([runtime, data]: [string, any]) => ({
      runtime,
      totalTasks: data.totalTasks || 0,
      successfulTasks: data.successfulTasks || 0,
      failedTasks: data.failedTasks || 0,
      successRate: data.successRate || 0,
      avgDurationMinutes: data.avgDurationMinutes || 0,
      avgCost: data.avgCost || 0,
      totalCost: data.totalCost || 0,
      totalTokens: data.totalTokens || 0,
      byCapability: data.byCapability || {},
      byModel: data.byModel || {},
      dailyStats: data.dailyStats || [],
    }));

    // Calculate aggregates
    const totalTasks = comparison.reduce((sum, r) => sum + r.totalTasks, 0);
    const totalCost = comparison.reduce((sum, r) => sum + r.totalCost, 0);
    const totalTokens = comparison.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalSuccessful = comparison.reduce((sum, r) => sum + r.successfulTasks, 0);

    res.json({
      runtimes: comparison,
      aggregated: {
        totalTasks,
        totalCost,
        totalTokens,
        avgSuccessRate: totalTasks > 0 ? totalSuccessful / totalTasks : 0,
      },
      lastUpdated: metrics.lastUpdated,
    });
  } catch (error: any) {
    console.error('Error getting runtime metrics:', error);
    res.status(500).json({ error: 'Failed to get runtime metrics: ' + error.message });
  }
});

// GET /api/metrics/tasks - Recent tasks
app.get('/api/metrics/tasks', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const metrics = loadRuntimeMetrics();
    const tasks = (metrics.tasks || [])
      .sort((a: any, b: any) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
      .slice(0, limit);

    res.json({ tasks });
  } catch (error: any) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks: ' + error.message });
  }
});

// Ensure tmux is running at startup
ensureTmuxRunning().catch((err) => {
  console.error('Failed to ensure tmux is running:', err);
});

// Cloister auto-start is handled inside server.listen() callback below
// to avoid double-initialization race conditions

// In production, serve the frontend static files
if (process.env.NODE_ENV === 'production') {
  const frontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
  if (existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(join(frontendPath, 'index.html'));
      }
    });
    console.log(`Serving frontend from ${frontendPath}`);
  }
}

// Create HTTP server and attach WebSocket server for terminal
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

// Socket.io for real-time issue push (coexists with WS terminal on different path)
const socketIo = new SocketIOServer(server, {
  path: '/socket.io',
  cors: { origin: '*' },
});

// Initialize cache and issue data service
const cacheService = new CacheService();
const issueDataService = new IssueDataService(socketIo, cacheService);

// Track active PTY sessions
const activePtys = new Map<string, pty.IPty>();

// Health check endpoint (must be after wss and activePtys are defined)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: {
      websockets: wss.clients.size,
      activePtys: activePtys.size,
      socketIoClients: socketIo.engine?.clientsCount ?? 0,
    }
  });
});

// Cache status diagnostics endpoint
app.get('/api/cache-status', (_req, res) => {
  res.json(issueDataService.getDiagnostics());
});

wss.on('connection', (ws: WebSocket, req) => {
  // Parse session name from URL query param: /ws/terminal?session=planning-min-123
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionName = url.searchParams.get('session');

  if (!sessionName) {
    ws.close(1008, 'Session name required');
    return;
  }

  console.log(`WebSocket connected for session: ${sessionName}`);

  // IMPORTANT: Buffer messages immediately to avoid losing them during async setup
  // The client sends resize dimensions immediately on connect, but we have async
  // operations (SSH checks) that take time. Without buffering, messages are lost.
  const earlyMessages: string[] = [];
  let messageHandler: ((data: string) => void) | null = null;

  ws.on('message', (data) => {
    const message = data.toString();
    if (messageHandler) {
      messageHandler(message);
    } else {
      earlyMessages.push(message);
      console.log(`[ws] Buffered early message for ${sessionName}: ${message.slice(0, 50)}...`);
    }
  });

  // Check if tmux session exists (async to avoid blocking event loop)
  (async () => {
    // Check if this is a remote session by reading agent state
    // Check both state.json (local agents) and remote-state.json (remote agents)
    let isRemote = false;
    let vmName = '';
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
    const stateFile = join(agentStateDir, 'state.json');
    const remoteStateFile = join(agentStateDir, 'remote-state.json');

    try {
      // Try remote-state.json first (for remote agents)
      if (existsSync(remoteStateFile)) {
        const stateContent = readFileSync(remoteStateFile, 'utf-8');
        const state = JSON.parse(stateContent);
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
          console.log(`[ws] Session ${sessionName} is remote on VM: ${vmName} (from remote-state.json)`);
        }
      } else if (existsSync(stateFile)) {
        // Fall back to state.json (for local agents or legacy format)
        const stateContent = readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(stateContent);
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
          console.log(`[ws] Session ${sessionName} is remote on VM: ${vmName} (from state.json)`);
        }
      }
    } catch (err) {
      console.log(`[ws] Could not read agent state for ${sessionName}:`, err);
    }

    // Check if tmux session exists (local or remote)
    try {
      if (isRemote) {
        const { stdout } = await execAsync(`ssh -A ${vmName}.exe.xyz "tmux list-sessions -F \\"#{session_name}\\" 2>/dev/null || echo \\"\\""`, { timeout: 10000 });
        const sessions = stdout.trim().split('\n').filter(Boolean);
        if (!sessions.includes(sessionName)) {
          ws.close(1008, `Remote session ${sessionName} not found on ${vmName}`);
          return;
        }
      } else {
        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""');
        const sessions = stdout.trim().split('\n').filter(Boolean);
        if (!sessions.includes(sessionName)) {
          ws.close(1008, `Session ${sessionName} not found`);
          return;
        }
      }
    } catch (err) {
      ws.close(1008, `Failed to list tmux sessions: ${err}`);
      return;
    }

    // Check for existing PTY connection and clean it up to prevent duplicates
    // This can happen if user refreshes the page or opens multiple tabs
    const existingPty = activePtys.get(sessionName);
    if (existingPty) {
      console.log(`[ws] Cleaning up existing PTY for ${sessionName} before creating new one`);
      try {
        existingPty.write('\x02d'); // Ctrl-b d to detach from tmux
        setTimeout(() => existingPty.kill(), 100);
      } catch {
        // Ignore errors during cleanup
      }
      activePtys.delete(sessionName);
    }

    // For remote sessions, skip the pre-resize since we'll use client dimensions
    // For local sessions, do the pre-resize
    if (!isRemote) {
      try {
        await execAsync(`tmux resize-window -t ${sessionName} -x 120 -y 29 2>/dev/null || true`, { timeout: 5000 });
      } catch {
        console.log(`[ws] Initial resize failed for ${sessionName}`);
      }
    }

    if (isRemote) {
      // ATTEMPT 14: Wait for client dimensions before starting SSH
      // The root cause of the terminal visual bug is a dimension mismatch:
      // - Server was starting SSH at hardcoded 120x29
      // - Client would later send its actual dimensions (e.g., 106x29 after FitAddon)
      // - By then, tmux was already outputting at 120 columns, causing status bar to wrap
      //
      // Fix: Wait for the client to send its dimensions FIRST, then start SSH
      // with the correct dimensions from the beginning.

      // Lazy-load ssh2 only when remote sessions are actually used
      if (!SSHClient) {
        try {
          const ssh2 = await import('ssh2');
          SSHClient = ssh2.Client;
        } catch (e) {
          console.error('[ssh2] ssh2 package is not installed. Install it with: npm install ssh2');
          ws.close(1011, 'ssh2 package not installed - required for remote sessions');
          return;
        }
      }

      let sshClient: InstanceType<typeof SSHClient> | null = null;
      let sshStream: any = null;
      let currentCols = 120;
      let currentRows = 29;
      let sshStarted = false;
      let pendingInput: string[] = [];  // Buffer input until SSH is ready

      // Read the SSH private key for exe.xyz hosts (do this early)
      const sshKeyPath = join(homedir(), '.ssh', 'id_ed25519_exedev');
      let privateKey: Buffer | undefined;
      try {
        privateKey = readFileSync(sshKeyPath);
        console.log(`[ssh2] Using private key: ${sshKeyPath}`);
      } catch (e) {
        console.error(`[ssh2] Failed to read SSH key ${sshKeyPath}:`, e);
        ws.close(1011, 'SSH key not found');
        return;
      }

      // Function to start SSH connection with correct dimensions
      const startSSH = async (cols: number, rows: number) => {
        if (sshStarted) return;
        sshStarted = true;

        currentCols = cols;
        currentRows = rows;

        console.log(`[ssh2] Starting SSH with client dimensions: ${cols}x${rows}`);

        // Pre-resize tmux window BEFORE attaching with CLIENT dimensions
        await execAsync(`ssh -A ${vmName}.exe.xyz "tmux resize-window -t ${sessionName} -x ${cols} -y ${rows} 2>/dev/null || true"`, { timeout: 10000 })
          .catch(() => {});

        sshClient = new SSHClient();

        sshClient.on('ready', () => {
          console.log(`[ssh2] Connected to ${vmName}.exe.xyz for ${sessionName}`);

          // Use exec() with PTY to directly attach to tmux
          // Use the client's dimensions, not hardcoded values
          const tmuxCmd = `TERM=xterm-256color COLORTERM=truecolor LANG=en_US.UTF-8 tmux attach-session -t ${sessionName}`;
          sshClient!.exec(tmuxCmd, {
            pty: {
              term: 'xterm-256color',
              cols: currentCols,  // Use client dimensions
              rows: currentRows,
              modes: {
                // Input modes
                ECHO: 1,        // Enable echo
                ICANON: 0,      // Disable canonical mode (raw input)
                ICRNL: 0,       // Don't map CR to NL (raw)
                ISIG: 1,        // Enable signals
                IEXTEN: 0,      // Disable extended input
                // Output modes - DISABLE post-processing to let escape sequences through raw
                OPOST: 0,       // Disable output processing - pass escape sequences through raw
                ONLCR: 0,       // Don't map NL to CR-NL
              }
            }
          }, (err, stream) => {
            if (err) {
              console.error(`[ssh2] Exec error:`, err);
              ws.close(1011, 'Failed to exec tmux');
              return;
            }

            sshStream = stream;
            console.log(`[ssh2] Tmux attached for ${sessionName} at ${currentCols}x${currentRows}`);

            // Flush any pending input that arrived before SSH was ready
            if (pendingInput.length > 0) {
              console.log(`[ssh2] Flushing ${pendingInput.length} pending inputs`);
              for (const input of pendingInput) {
                sshStream.write(input);
              }
              pendingInput = [];
            }

            // DEBUG: Enable detailed logging to diagnose terminal corruption
            const DEBUG_TERMINAL = process.env.DEBUG_TERMINAL === '1';
            let debugMsgCount = 0;
            let sshInCount = 0;

            // Helper to show escape sequences in readable form
            const escapeForLog = (buf: Buffer): string => {
              return buf.toString('utf8').replace(/[\x00-\x1f\x7f-\xff]/g, (c) => {
                const code = c.charCodeAt(0);
                if (code === 0x1b) return '\\e';
                if (code === 0x0a) return '\\n';
                if (code === 0x0d) return '\\r';
                return `\\x${code.toString(16).padStart(2, '0')}`;
              });
            };

            // Send data immediately like WebSSH2 does
            stream.on('data', (data: Buffer) => {
              // DEBUG: Log incoming SSH data chunks
              if (DEBUG_TERMINAL) {
                sshInCount++;
                debugMsgCount++;
                if (sshInCount <= 50 || sshInCount % 100 === 0) {
                  console.log(`[ssh2-debug] SSH-IN #${sshInCount} len=${data.length}`);
                  console.log(`[ssh2-debug]   DATA: ${escapeForLog(data).slice(0, 200)}${data.length > 200 ? '...' : ''}`);
                }
              }

              // Send immediately as UTF-8 string (like WebSSH2)
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(data.toString('utf8'));
              }
            });

            if (DEBUG_TERMINAL) {
              console.log(`[ssh2-debug] Terminal debug logging enabled for ${sessionName}`);
            }

            stream.on('close', () => {
              console.log(`[ssh2] Stream closed for ${sessionName}`);
              sshClient?.end();
              if (ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'Session ended');
              }
            });

            stream.stderr.on('data', (data: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(data.toString('utf8'));
              }
            });
          });
        });

        sshClient.on('error', (err) => {
          console.error(`[ssh2] Connection error:`, err);
          ws.close(1011, 'SSH connection failed');
        });

        sshClient.on('close', () => {
          console.log(`[ssh2] Connection closed for ${sessionName}`);
        });

        // Connect using private key (exe.xyz hosts use id_ed25519_exedev)
        sshClient.connect({
          host: `${vmName}.exe.xyz`,
          port: 22,
          username: process.env.USER || 'root',
          privateKey: privateKey,
          algorithms: {
            serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519'],
          },
        });
      };

      // Handle WebSocket messages - wait for resize before starting SSH
      // Use the messageHandler pattern to process buffered early messages
      const handleMessage = (message: string) => {
        console.log(`[ws] Processing message for ${sessionName}: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

        if (message.startsWith('{')) {
          try {
            const parsed = JSON.parse(message);
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              if (!sshStarted) {
                // First resize message - start SSH with these dimensions
                startSSH(parsed.cols, parsed.rows);
              } else {
                // Subsequent resize - update dimensions
                currentCols = parsed.cols;
                currentRows = parsed.rows;
                if (sshStream) {
                  // Resize the SSH PTY
                  sshStream.setWindow(parsed.rows, parsed.cols, 0, 0);
                  // ALSO resize the tmux window to match
                  execAsync(`ssh -A ${vmName}.exe.xyz "tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} 2>/dev/null || true"`, { timeout: 5000 })
                    .catch(() => {}); // Ignore errors - best effort
                }
              }
              return;
            }
          } catch {
            // Invalid JSON, treat as terminal input
          }
        }

        // Terminal input
        if (sshStream) {
          sshStream.write(message);
        } else {
          // Buffer input until SSH is ready
          pendingInput.push(message);
        }
      };

      // Set the message handler and process any buffered early messages
      messageHandler = handleMessage;
      console.log(`[ws] Processing ${earlyMessages.length} buffered messages for ${sessionName}`);
      for (const msg of earlyMessages) {
        handleMessage(msg);
      }
      earlyMessages.length = 0;  // Clear the buffer

      ws.on('close', () => {
        console.log(`WebSocket closed for session: ${sessionName}`);
        if (sshStream) {
          sshStream.write('\x02d'); // Ctrl-b d to detach
          setTimeout(() => sshClient?.end(), 100);
        } else {
          sshClient?.end();
        }
      });

      ws.on('error', (err) => {
        console.error(`WebSocket error for ${sessionName}:`, err);
        sshClient?.end();
      });

      return;
    }

    // Local sessions use node-pty directly
    let ptyProcess: pty.IPty;
    ptyProcess = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } as { [key: string]: string },
    });

    activePtys.set(sessionName, ptyProcess);

    // Forward PTY output to WebSocket
    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`PTY for ${sessionName} exited with code ${exitCode}`);
      activePtys.delete(sessionName);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Session ended');
      }
    });

    // Track last resize to debounce/dedupe
    let lastResizeCols = 120;
    let lastResizeRows = 30;

    // Set up message handler for local sessions (using the buffered message pattern)
    const handleLocalMessage = (message: string) => {
      // Handle resize messages
      if (message.startsWith('{')) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            if (parsed.cols === lastResizeCols && parsed.rows === lastResizeRows) {
              return;
            }
            lastResizeCols = parsed.cols;
            lastResizeRows = parsed.rows;
            ptyProcess.resize(parsed.cols, parsed.rows);
            execAsync(`tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} 2>/dev/null || true`)
              .catch(() => {});
            return;
          }
        } catch {
          // Invalid JSON, treat as terminal input
        }
      }

      ptyProcess.write(message);
    };

    // Set the message handler and process any buffered early messages
    messageHandler = handleLocalMessage;
    for (const msg of earlyMessages) {
      handleLocalMessage(msg);
    }
    earlyMessages.length = 0;

    // Clean up on WebSocket close
    ws.on('close', () => {
      console.log(`WebSocket closed for session: ${sessionName}`);
      ptyProcess.write('\x02d'); // Ctrl-b d
      setTimeout(() => {
        ptyProcess.kill();
        activePtys.delete(sessionName);
      }, 100);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${sessionName}:`, err);
      ptyProcess.kill();
      activePtys.delete(sessionName);
    });
  })();
});

// ============================================================================
// Remote Workspaces API (exe.dev)
// ============================================================================

import {
  createExeProvider,
  isRemoteAvailable,
  loadRemoteAgentState,
  listRemoteAgents,
  spawnRemoteAgent,
  killRemoteAgent,
  getRemoteAgentOutput,
  sendToRemoteAgent,
} from '../../lib/remote/index.js';
import { loadConfig as loadPanConfig, type RemoteConfig } from '../../lib/config.js';

// Helper to load workspace metadata
function loadRemoteWorkspaceMetadata(issueId: string): any | null {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadataPath = join(process.env.HOME || '', '.panopticon', 'workspaces', `${normalizedId}.yaml`);

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const yaml = require('yaml');
    const content = readFileSync(metadataPath, 'utf-8');
    return yaml.parse(content);
  } catch {
    return null;
  }
}

// Helper to list all remote workspace metadata files
function listRemoteWorkspaceMetadata(): any[] {
  const workspacesDir = join(process.env.HOME || '', '.panopticon', 'workspaces');

  if (!existsSync(workspacesDir)) {
    return [];
  }

  try {
    const yaml = require('yaml');
    const files = readdirSync(workspacesDir).filter(f => f.endsWith('.yaml'));
    const workspaces: any[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(workspacesDir, file), 'utf-8');
        const metadata = yaml.parse(content);
        if (metadata.location === 'remote') {
          workspaces.push(metadata);
        }
      } catch {
        // Skip invalid files
      }
    }

    return workspaces;
  } catch {
    return [];
  }
}

// GET /api/remote/status - Get remote provider status
app.get('/api/remote/status', async (_req, res) => {
  try {
    const config = loadPanConfig();
    const remoteConfig = config.remote;
    const enabled = remoteConfig?.enabled ?? false;

    if (!enabled) {
      return res.json({
        enabled: false,
        available: false,
        reason: 'Remote workspaces not enabled. Run: pan remote setup',
      });
    }

    const availability = await isRemoteAvailable();

    if (!availability.available) {
      return res.json({
        enabled: true,
        available: false,
        reason: availability.reason,
      });
    }

    const exe = createExeProvider({ infraVm: remoteConfig?.exe?.infra_vm });
    const vms = await exe.listVms();

    res.json({
      enabled: true,
      available: true,
      provider: remoteConfig?.provider || 'exe',
      infraVm: remoteConfig?.exe?.infra_vm,
      vms: vms.map(vm => ({
        name: vm.name,
        status: vm.status,
        isInfra: vm.name === remoteConfig?.exe?.infra_vm,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/remote/workspaces - List remote workspaces
app.get('/api/remote/workspaces', async (_req, res) => {
  try {
    const workspaces = listRemoteWorkspaceMetadata();

    // Enrich with VM status if possible
    const config = loadPanConfig();
    const exe = createExeProvider({ infraVm: config.remote?.exe?.infra_vm });

    let vms: any[] = [];
    try {
      vms = await exe.listVms();
    } catch {
      // Can't get VM status - return workspaces without status
    }

    const enriched = workspaces.map(ws => {
      const vmInfo = vms.find(vm => vm.name === ws.vmName);
      return {
        ...ws,
        vmStatus: vmInfo?.status || 'unknown',
      };
    });

    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/remote/workspaces/:issueId - Get specific remote workspace
app.get('/api/remote/workspaces/:issueId', async (req, res) => {
  try {
    const { issueId } = req.params;
    const metadata = loadRemoteWorkspaceMetadata(issueId);

    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    // Get VM status
    const config = loadPanConfig();
    const exe = createExeProvider({ infraVm: config.remote?.exe?.infra_vm });

    let vmStatus = 'unknown';
    try {
      vmStatus = await exe.getStatus(metadata.vmName);
    } catch {
      // Ignore - status unknown
    }

    // Get agent status if running
    let agentStatus = null;
    if (vmStatus === 'running') {
      const agentId = `agent-${issueId.toLowerCase()}`;
      const agentState = loadRemoteAgentState(agentId);
      if (agentState) {
        agentStatus = {
          id: agentState.id,
          status: agentState.status,
          model: agentState.model,
          startedAt: agentState.startedAt,
        };
      }
    }

    res.json({
      ...metadata,
      vmStatus,
      agent: agentStatus,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/remote/workspaces/:issueId/start - Start remote workspace
app.post('/api/remote/workspaces/:issueId/start', async (req, res) => {
  try {
    const { issueId } = req.params;
    const metadata = loadRemoteWorkspaceMetadata(issueId);

    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    const config = loadPanConfig();
    const exe = createExeProvider({ infraVm: config.remote?.exe?.infra_vm });

    await exe.startVm(metadata.vmName);

    // Start containers
    await exe.ssh(metadata.vmName, 'cd /workspace && docker compose up -d 2>/dev/null || true');

    res.json({ success: true, message: `Workspace ${issueId} started` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/remote/workspaces/:issueId/stop - Stop remote workspace
app.post('/api/remote/workspaces/:issueId/stop', async (req, res) => {
  try {
    const { issueId } = req.params;
    const metadata = loadRemoteWorkspaceMetadata(issueId);

    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    const config = loadPanConfig();
    const exe = createExeProvider({ infraVm: config.remote?.exe?.infra_vm });

    // Stop containers first
    await exe.ssh(metadata.vmName, 'docker compose down 2>/dev/null || true');

    // Stop VM
    await exe.stopVm(metadata.vmName);

    res.json({ success: true, message: `Workspace ${issueId} stopped` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/remote/workspaces/:issueId/agent/start - Start agent on remote workspace
app.post('/api/remote/workspaces/:issueId/agent/start', async (req, res) => {
  try {
    const { issueId } = req.params;
    const { prompt, model } = req.body;

    const metadata = loadRemoteWorkspaceMetadata(issueId);
    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    // Sync all credentials before spawning (tokens may have expired)
    const exe = createExeProvider({ infraVm: metadata.infraVm });
    await exe.syncAllCredentials(metadata.vmName);

    const state = await spawnRemoteAgent({
      issueId,
      workspace: metadata,
      prompt,
      model,
    });

    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/remote/workspaces/:issueId/agent/stop - Stop agent on remote workspace
app.post('/api/remote/workspaces/:issueId/agent/stop', async (req, res) => {
  try {
    const { issueId } = req.params;
    const metadata = loadRemoteWorkspaceMetadata(issueId);

    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    await killRemoteAgent(agentId, metadata.vmName);

    res.json({ success: true, message: `Agent ${agentId} stopped` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/remote/workspaces/:issueId/agent/output - Get agent output
app.get('/api/remote/workspaces/:issueId/agent/output', async (req, res) => {
  try {
    const { issueId } = req.params;
    const lines = parseInt(req.query.lines as string) || 100;

    const metadata = loadRemoteWorkspaceMetadata(issueId);
    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    const output = await getRemoteAgentOutput(agentId, metadata.vmName, lines);

    res.json({ output });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/remote/workspaces/:issueId/agent/tell - Send message to agent
app.post('/api/remote/workspaces/:issueId/agent/tell', async (req, res) => {
  try {
    const { issueId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const metadata = loadRemoteWorkspaceMetadata(issueId);
    if (!metadata) {
      return res.status(404).json({ error: 'Remote workspace not found' });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    await sendToRemoteAgent(agentId, metadata.vmName, message);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Mission Control API - Activity & Planning Artifacts
// ============================================================================

// GET /api/mission-control/activity/:issueId - Aggregate all agent activity for a feature
app.get('/api/mission-control/activity/:issueId', async (req, res) => {
  const { issueId } = req.params;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
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

    for (const checkId of [planningAgentId, agentId]) {
      const agentDir = join(agentsDir, checkId);
      if (existsSync(agentDir)) {
        const stateFile = join(agentDir, 'state.json');
        if (existsSync(stateFile)) {
          try {
            const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
            const isPlanning = checkId.startsWith('planning-');
            const sectionType = isPlanning ? 'planning' : 'work';

            // Try to read agent output from tmux
            let transcript = '';
            try {
              const { stdout } = await execAsync(
                `tmux capture-pane -t ${checkId} -p -S -500 2>/dev/null || echo ""`,
                { encoding: 'utf-8', timeout: 5000 }
              );
              transcript = stdout.trim();
            } catch { /* agent may not be running */ }

            sections.push({
              type: sectionType,
              sessionId: checkId,
              model: state.model || state.runtime || 'unknown',
              startedAt: state.startedAt || state.createdAt || new Date().toISOString(),
              duration: state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : null,
              status: state.state === 'active' ? 'running' : state.state === 'suspended' ? 'completed' : (state.status || 'completed'),
              transcript,
            });
          } catch { /* skip malformed state */ }
        }
      }
    }

    // 2. Check for specialist runs (review, test, merge)
    const specialistsDir = join(homedir(), '.panopticon', 'specialists');
    if (existsSync(specialistsDir)) {
      // Check all project directories for runs related to this issue
      const projectPath = getProjectPath(undefined, issuePrefix);
      const projectName = projectPath ? projectPath.split('/').pop() || '' : '';

      // Try common project key patterns
      const projectKeys = [projectName, issuePrefix.toLowerCase()].filter(Boolean);

      for (const projectKey of projectKeys) {
        for (const specialistType of ['review-agent', 'test-agent', 'merge-agent']) {
          const runsDir = join(specialistsDir, projectKey, specialistType, 'runs');
          if (!existsSync(runsDir)) continue;

          try {
            const runFiles = readdirSync(runsDir)
              .filter(f => f.includes(issueLower) && f.endsWith('.log'))
              .sort()
              .reverse()
              .slice(0, 3); // Last 3 runs per type

            for (const runFile of runFiles) {
              const content = readFileSync(join(runsDir, runFile), 'utf-8');

              // Parse run metadata from log header
              const startedMatch = content.match(/Started: (.+)/);
              const statusMatch = content.match(/Status: (.+)/);
              const finishedMatch = content.match(/Finished: (.+)/);

              const startedAt = startedMatch ? startedMatch[1].trim() : '';
              const finishedAt = finishedMatch ? finishedMatch[1].trim() : '';
              const runStatus = statusMatch ? statusMatch[1].trim() : 'completed';

              const typeMap: Record<string, string> = {
                'review-agent': 'review',
                'test-agent': 'test',
                'merge-agent': 'merge',
              };

              sections.push({
                type: typeMap[specialistType] || specialistType,
                sessionId: runFile.replace('.log', ''),
                model: 'specialist',
                startedAt,
                duration: startedAt && finishedAt
                  ? Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
                  : null,
                status: runStatus === 'passed' ? 'completed' : runStatus === 'failed' ? 'failed' : 'completed',
                transcript: content,
              });
            }
          } catch { /* skip unreadable runs */ }
        }
      }
    }

    // Sort sections by startedAt
    sections.sort((a, b) => {
      if (!a.startedAt) return 1;
      if (!b.startedAt) return -1;
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    });

    res.json({ issueId, sections });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch activity: ' + error.message });
  }
});

// GET /api/mission-control/planning/:issueId - Get planning artifacts
app.get('/api/mission-control/planning/:issueId', async (req, res) => {
  const { issueId } = req.params;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
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
      return res.json(result);
    }

    // Read core planning docs
    const prdPath = join(planningDir, 'PRD.md');
    const statePath = join(planningDir, 'STATE.md');
    const inferencePath = join(planningDir, 'INFERENCE.md');

    if (existsSync(prdPath)) result.prd = readFileSync(prdPath, 'utf-8');
    if (existsSync(statePath)) result.state = readFileSync(statePath, 'utf-8');
    if (existsSync(inferencePath)) result.inference = readFileSync(inferencePath, 'utf-8');

    // Read STATUS_REVIEW.md (AI-generated progress review)
    const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');
    if (existsSync(statusReviewPath)) {
      result.statusReview = readFileSync(statusReviewPath, 'utf-8');
      try {
        result.statusReviewedAt = statSync(statusReviewPath).mtime.toISOString();
      } catch { /* skip */ }
    }

    // Also check PLANNING_PROMPT.md as fallback for PRD
    if (!result.prd) {
      const promptPath = join(planningDir, 'PLANNING_PROMPT.md');
      if (existsSync(promptPath)) result.prd = readFileSync(promptPath, 'utf-8');
    }

    // Read subdirectory artifacts
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

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch planning artifacts: ' + error.message });
  }
});

// POST /api/mission-control/planning/:issueId/status-review - Generate AI status review
app.post('/api/mission-control/planning/:issueId/status-review', async (req, res) => {
  const { issueId } = req.params;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planningDir = join(workspacePath, '.planning');

    if (!existsSync(planningDir)) {
      return res.status(404).json({ error: 'No planning directory found' });
    }

    // Gather context: PRD, STATE, git diff, file list
    const prdPath = join(planningDir, 'PRD.md');
    const statePath = join(planningDir, 'STATE.md');
    const prd = existsSync(prdPath) ? readFileSync(prdPath, 'utf-8') : null;
    const state = existsSync(statePath) ? readFileSync(statePath, 'utf-8') : null;

    if (!prd && !state) {
      return res.status(400).json({ error: 'No PRD or STATE.md to review against' });
    }

    // Get git diff summary from workspace
    let gitDiff = '';
    let gitLog = '';
    try {
      const { stdout: diff } = await execAsync(
        `cd "${workspacePath}" && git diff --stat main 2>/dev/null || git diff --stat HEAD~5 2>/dev/null || echo "No git diff available"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      gitDiff = diff.slice(0, 3000); // Limit size
    } catch { /* skip */ }

    try {
      const { stdout: log } = await execAsync(
        `cd "${workspacePath}" && git log --oneline -20 2>/dev/null || echo "No git log available"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      gitLog = log.slice(0, 2000);
    } catch { /* skip */ }

    // Get list of files changed
    let filesChanged = '';
    try {
      const { stdout } = await execAsync(
        `cd "${workspacePath}" && git diff --name-only main 2>/dev/null || git diff --name-only HEAD~5 2>/dev/null || echo "No files changed"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      filesChanged = stdout.slice(0, 2000);
    } catch { /* skip */ }

    // Check review/test status
    const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
    let reviewStatus = 'unknown';
    let testStatus = 'unknown';
    const reviewStatusFile = join(agentDir, 'review-status.json');
    if (existsSync(reviewStatusFile)) {
      try {
        const rs = JSON.parse(readFileSync(reviewStatusFile, 'utf-8'));
        reviewStatus = rs.reviewStatus || 'unknown';
        testStatus = rs.testStatus || 'unknown';
      } catch { /* skip */ }
    }

    // Generate the status review markdown
    const now = new Date().toISOString();
    const review = `# Status Review - ${issueId}

*Generated: ${now}*

## Pipeline Status

| Stage | Status |
|-------|--------|
| Work | ${reviewStatus === 'unknown' ? 'In Progress' : 'Complete'} |
| Review | ${reviewStatus} |
| Tests | ${testStatus} |

## PRD Requirements

${prd ? prd.split('\n').filter(l => l.match(/^[-*]\s|^#{1,3}\s|acceptance|criteria|requirement/i)).slice(0, 50).join('\n') : '(No PRD available)'}

## Code Changes

### Files Modified
\`\`\`
${filesChanged || 'No changes detected'}
\`\`\`

### Diff Summary
\`\`\`
${gitDiff || 'No diff available'}
\`\`\`

### Recent Commits
\`\`\`
${gitLog || 'No commits yet'}
\`\`\`

## STATE.md Summary

${state ? state.split('\n').slice(0, 30).join('\n') : '(No STATE.md available)'}

---
*Review by Panopticon Mission Control*
`;

    // Write to disk
    const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');
    writeFileSync(statusReviewPath, review, 'utf-8');

    res.json({ success: true, statusReview: review, reviewedAt: now });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate status review: ' + error.message });
  }
});

// POST /api/mission-control/planning/:issueId/upload - Upload transcript or note
app.post('/api/mission-control/planning/:issueId/upload', async (req, res) => {
  const { issueId } = req.params;
  const { type, filename, content } = req.body;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  if (!type || !filename || !content) {
    return res.status(400).json({ error: 'type, filename, and content are required' });
  }

  if (!['transcript', 'note'].includes(type)) {
    return res.status(400).json({ error: 'type must be transcript or note' });
  }

  // Sanitize filename
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const ext = safeName.endsWith('.md') || safeName.endsWith('.txt') ? '' : '.md';

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const subdir = type === 'transcript' ? 'transcripts' : 'notes';
    const dirPath = join(workspacePath, '.planning', subdir);

    mkdirSync(dirPath, { recursive: true });
    const filePath = join(dirPath, safeName + ext);
    writeFileSync(filePath, content, 'utf-8');

    // Emit socket event
    if (socketIo) {
      socketIo.emit('planning:sync', {
        issueId,
        artifactType: type,
        filename: safeName + ext,
      });
    }

    res.json({ success: true, path: filePath });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to upload artifact: ' + error.message });
  }
});

// POST /api/mission-control/planning/:issueId/sync-discussions - Sync tracker discussions
app.post('/api/mission-control/planning/:issueId/sync-discussions', async (req, res) => {
  const { issueId } = req.params;
  const { tracker } = req.body;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  if (!tracker || !['github', 'linear'].includes(tracker)) {
    return res.status(400).json({ error: 'tracker must be github or linear' });
  }

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const discussionsDir = join(workspacePath, '.planning', 'discussions');
    mkdirSync(discussionsDir, { recursive: true });

    const syncedFiles: string[] = [];

    if (tracker === 'github') {
      const ghConfig = getGitHubConfigShared();
      if (!ghConfig) {
        return res.status(400).json({ error: 'GitHub not configured' });
      }

      // Use gh CLI to fetch issue comments
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

      // Also sync PR discussions if any
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
      const linearApiKey = getLinearApiKeyShared();
      if (!linearApiKey) {
        return res.status(400).json({ error: 'Linear not configured' });
      }

      // Fetch Linear issue comments via API
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
          const body = comments.map((c: any) =>
            `## ${c.user?.name || 'Unknown'} (${c.createdAt})\n\n${c.body}\n\n---\n`
          ).join('\n');
          writeFileSync(join(discussionsDir, filename), header + body, 'utf-8');
          syncedFiles.push(filename);
        }
      } catch (linearErr: any) {
        console.warn(`Failed to sync Linear comments for ${issueId}:`, linearErr.message);
      }
    }

    // Emit socket event
    if (socketIo) {
      for (const file of syncedFiles) {
        socketIo.emit('planning:sync', {
          issueId,
          artifactType: 'discussion',
          filename: file,
        });
      }
    }

    res.json({ synced: syncedFiles.length, files: syncedFiles });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to sync discussions: ' + error.message });
  }
});

// POST /api/mission-control/planning/:issueId/init - Initialize .planning directory
app.post('/api/mission-control/planning/:issueId/init', async (req, res) => {
  const { issueId } = req.params;
  const { shadow } = req.body; // Whether this is a shadow engineering workspace
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planningDir = join(workspacePath, '.planning');

    // Create all subdirectories
    for (const subdir of ['transcripts', 'discussions', 'notes']) {
      mkdirSync(join(planningDir, subdir), { recursive: true });
    }

    // Initialize INFERENCE.md for shadow engineering
    if (shadow) {
      const inferencePath = join(planningDir, 'INFERENCE.md');
      if (!existsSync(inferencePath)) {
        writeFileSync(inferencePath, `# Inference Document - ${issueId}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n\n## Understanding\n\n(pending)\n\n## Gaps & Risks\n\n(pending)\n`, 'utf-8');
      }
    }

    res.json({ success: true, path: planningDir });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to initialize planning directory: ' + error.message });
  }
});

// GET /api/mission-control/projects - Get project tree with active features
app.get('/api/mission-control/projects', async (_req, res) => {
  try {
    const projects = listProjects();

    // Get active tmux sessions once (async, non-blocking)
    let tmuxSessions: Set<string> = new Set();
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) tmuxSessions.add(trimmed);
      }
    } catch { /* tmux not running */ }

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

          // Check agent status and last activity
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

          // Filter: only show workspaces with active tmux, recent activity, or recent modification
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

          // Check for planning artifacts
          const hasPlanning = existsSync(planningDir);
          const hasPrd = hasPlanning && (existsSync(join(planningDir, 'PRD.md')) || existsSync(join(planningDir, 'PLANNING_PROMPT.md')));
          const hasState = hasPlanning && existsSync(join(planningDir, 'STATE.md'));
          const isShadow = hasPlanning && existsSync(join(planningDir, 'INFERENCE.md'));

          // Check review status for lifecycle state
          const reviewStatusFile = join(agentDir, 'review-status.json');
          let reviewStatus: string | null = null;
          let testStatus: string | null = null;
          if (existsSync(reviewStatusFile)) {
            try {
              const rs = JSON.parse(readFileSync(reviewStatusFile, 'utf-8'));
              reviewStatus = rs.reviewStatus || null;
              testStatus = rs.testStatus || null;
            } catch { /* skip */ }
          }

          // Determine lifecycle state label (tmux = most reliable active indicator)
          let stateLabel = 'Idle';
          if (hasTmux) stateLabel = 'In Progress';
          else if (reviewStatus === 'passed' && testStatus === 'passed') stateLabel = 'Done';
          else if (reviewStatus === 'reviewing' || reviewStatus === 'pending') stateLabel = 'In Review';
          else if (agentStatus === 'suspended') stateLabel = 'Suspended';
          else if (hasRecentAgentActivity && agentStatus === 'active') stateLabel = 'In Progress';
          else if (hasPrd && !hasState) stateLabel = 'Planning';
          else if (hasState) stateLabel = 'Has Context';

          let title = issueId;

          features.push({
            issueId,
            title,
            branch: `feature/${issueLower}`,
            status: (agentStatus === 'active' && hasRecentAgentActivity) ? 'running' : (hasTmux && agentStatus !== 'idle') ? 'running' : hasState ? 'has_state' : 'idle',
            stateLabel,
            agentStatus,
            hasPlanning,
            hasPrd,
            hasState,
            isShadow,
          });
        }
      }

      projectTree.push({
        name: project.config.name || projectPath.split('/').pop() || 'Unknown',
        path: projectPath,
        features,
      });
    }

    res.json(projectTree);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch project tree: ' + error.message });
  }
});

// ============================================================================
// Shadow Engineering API
// ============================================================================

// POST /api/shadow/:issueId/monitor - Run monitoring agent to generate/update INFERENCE.md
app.post('/api/shadow/:issueId/monitor', async (req, res) => {
  const { issueId } = req.params;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Dynamically import shadow engineering module
    const { gatherArtifacts, generateBasicInference, updateInferenceDocument, readInferenceDocument } = await import('../../lib/shadow-engineering/index.js');

    const config = { issueId, workspacePath, projectPath };
    const artifacts = await gatherArtifacts(config);
    const existingInference = readInferenceDocument(workspacePath);

    // Generate basic inference document (without LLM for now)
    const inference = generateBasicInference(config, artifacts);
    updateInferenceDocument(workspacePath, inference);

    // Emit socket event
    if (socketIo) {
      socketIo.emit('shadow:inference-update', { issueId, content: inference });
    }

    res.json({ success: true, inference });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to run monitoring agent: ' + error.message });
  }
});

// POST /api/shadow/:issueId/observe - Run observer cycle (poll PRs and comment)
app.post('/api/shadow/:issueId/observe', async (req, res) => {
  const { issueId } = req.params;
  const { mode } = req.body; // 'watch' or 'propose'
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];

  try {
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const ghConfig = getGitHubConfigShared();
    if (!ghConfig) {
      return res.status(400).json({ error: 'GitHub not configured - Observer requires GitHub' });
    }

    const { runObserverCycle } = await import('../../lib/shadow-engineering/index.js');

    const config = {
      issueId,
      workspacePath,
      projectPath,
      repo: `${ghConfig.owner}/${ghConfig.repos[0]}`,
      mode: (mode || 'watch') as 'watch' | 'propose',
    };

    const commentsPosted = await runObserverCycle(config);
    res.json({ success: true, commentsPosted });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to run observer: ' + error.message });
  }
});

// Serve static files in production mode
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

if (existsSync(publicDir)) {
  console.log(`Serving static files from ${publicDir}`);
  app.use(express.static(publicDir));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Panopticon API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket terminal available at ws://0.0.0.0:${PORT}/ws/terminal`);
  console.log(`Socket.io available at ws://0.0.0.0:${PORT}/socket.io`);

  // Start IssueDataService for background polling + real-time push
  try {
    await issueDataService.start();
    console.log('IssueDataService started (background polling + socket.io push)');
  } catch (error: any) {
    console.error('Failed to start IssueDataService:', error.message);
  }

  // Auto-start Cloister if configured
  try {
    const config = loadCloisterConfig();
    if (config.startup?.auto_start) {
      console.log('Cloister auto-start enabled, starting...');
      const service = getCloisterService();
      await service.start();
      console.log('Cloister auto-started successfully');
    }
  } catch (error: any) {
    console.error('Failed to auto-start Cloister:', error.message);
  }
});
