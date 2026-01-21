import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { execSync, exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync, readdirSync, appendFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { getCloisterService } from '../../lib/cloister/service.js';
import { loadCloisterConfig, saveCloisterConfig } from '../../lib/cloister/config.js';

// Promisified exec for non-blocking operations
const execAsync = promisify(exec);

// Ensure tmux server is running (starts one if not)
function ensureTmuxRunning(): void {
  try {
    execSync('tmux list-sessions 2>/dev/null', { encoding: 'utf-8' });
  } catch (e) {
    // Tmux server not running, start it with a dummy session
    try {
      execSync('tmux new-session -d -s panopticon-init', { encoding: 'utf-8' });
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
const PORT = parseInt(process.env.PORT || '3011', 10);

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
 */
function getActiveSessionPath(projectDir: string): string | null {
  const indexPath = join(projectDir, 'sessions-index.json');
  if (!existsSync(indexPath)) return null;

  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entries: SessionIndexEntry[] = index.entries || [];
    if (entries.length === 0) return null;

    // Sort by modified time descending, get most recent
    const sorted = entries.sort((a, b) =>
      new Date(b.modified).getTime() - new Date(a.modified).getTime()
    );
    return sorted[0].fullPath;
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
 */
function getPendingQuestions(jsonlPath: string): PendingQuestion[] {
  if (!existsSync(jsonlPath)) return [];

  try {
    const content = readFileSync(jsonlPath, 'utf-8');
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
function getAgentPendingQuestions(agentId: string): PendingQuestion[] {
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
  const labelNames = labels.map(l => l.toLowerCase());

  if (labelNames.some(l => l.includes('planning') || l.includes('discovery'))) {
    return 'planning';
  }
  if (labelNames.some(l => l === 'planned')) {
    return 'planned';
  }
  if (labelNames.some(l => l.includes('in review') || l.includes('review') || l.includes('qa'))) {
    return 'in_review';
  }
  if (labelNames.some(l => l.includes('in progress') || l.includes('wip'))) {
    return 'in_progress';
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
        const openJson = execSync(
          `gh issue list --repo ${owner}/${repo} --state open --limit 100 --json number,title,body,state,labels,assignees,createdAt,updatedAt,url`,
          { encoding: 'utf-8', timeout: 30000 }
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
        const closedJson = execSync(
          `gh issue list --repo ${owner}/${repo} --state closed --limit 50 --json number,title,body,state,labels,assignees,createdAt,updatedAt,url`,
          { encoding: 'utf-8', timeout: 30000 }
        );
        closedIssues = JSON.parse(closedJson);
      } catch (ghError: any) {
        console.error(`gh CLI failed for ${owner}/${repo} closed issues:`, ghError.message);
        // Fallback to API
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const closedResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues?state=closed&since=${thirtyDaysAgo.toISOString()}&per_page=50`,
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

// Get Linear issues using raw GraphQL for efficiency (single query with all data)
// Query params:
//   - cycle: 'current' (default) | 'all' | 'backlog' - filter by cycle
//   - includeCompleted: 'true' | 'false' (default) - include completed issues
app.get('/api/issues', async (req, res) => {
  try {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'LINEAR_API_KEY not configured' });
    }

    const cycleFilter = (req.query.cycle as string) || 'current';
    const includeCompleted = req.query.includeCompleted === 'true';

    // Build filter conditions as array
    const filterConditions: string[] = [];

    if (cycleFilter === 'current') {
      // Filter to current active cycle only
      filterConditions.push('cycle: { isActive: { eq: true } }');
    } else if (cycleFilter === 'backlog') {
      // Issues not in any cycle
      filterConditions.push('cycle: { null: true }');
    }
    // 'all' = no cycle filter

    // Optionally exclude completed issues
    if (!includeCompleted) {
      filterConditions.push('state: { type: { nin: ["completed", "canceled"] } }');
    }

    // Build final filter clause
    let filterClause = '';
    if (filterConditions.length === 1) {
      filterClause = `filter: { ${filterConditions[0]} }`;
    } else if (filterConditions.length > 1) {
      filterClause = `filter: { and: [${filterConditions.map(c => `{ ${c} }`).join(', ')}] }`;
    }

    // Use raw GraphQL to fetch all data in one query per page (no lazy loading)
    const allIssues: any[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const query = `
        query GetIssues($after: String) {
          issues(first: 100, after: $after, ${filterClause ? filterClause + ', ' : ''}orderBy: updatedAt) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              identifier
              title
              description
              priority
              url
              createdAt
              updatedAt
              state {
                name
                type
              }
              assignee {
                name
                email
              }
              labels {
                nodes {
                  name
                }
              }
              project {
                id
                name
                color
                icon
              }
              team {
                id
                name
                color
                icon
              }
              cycle {
                id
                name
                number
              }
            }
          }
        }
      `;

      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({ query, variables: { after: cursor } }),
      });

      const json = await response.json();

      if (json.errors) {
        console.error('GraphQL errors:', json.errors);
        throw new Error(json.errors[0]?.message || 'GraphQL error');
      }

      const issues = json.data?.issues;
      if (!issues) break;

      allIssues.push(...issues.nodes);
      hasMore = issues.pageInfo.hasNextPage;
      cursor = issues.pageInfo.endCursor;

      // Safety limit
      if (allIssues.length > 1000) break;
    }

    console.log(`Fetched ${allIssues.length} Linear issues (cycle=${cycleFilter}, includeCompleted=${includeCompleted})`);

    // Format Linear issues (data is already resolved, no extra API calls)
    const linearFormatted = allIssues.map((issue: any) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.state?.name || 'Backlog',
      stateType: issue.state?.type,
      priority: issue.priority,
      assignee: issue.assignee ? { name: issue.assignee.name, email: issue.assignee.email } : undefined,
      labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      // Use project if available, otherwise fall back to team
      project: issue.project ? {
        id: issue.project.id,
        name: issue.project.name,
        color: issue.project.color,
        icon: issue.project.icon,
      } : issue.team ? {
        id: issue.team.id,
        name: issue.team.name,
        color: issue.team.color,
        icon: issue.team.icon,
      } : undefined,
      // Include cycle info
      cycle: issue.cycle ? {
        id: issue.cycle.id,
        name: issue.cycle.name,
        number: issue.cycle.number,
      } : undefined,
      // Mark source as Linear
      source: 'linear',
    }));

    // Fetch GitHub issues in parallel
    const githubIssues = await fetchGitHubIssues();

    // Merge and sort by updatedAt
    const allFormatted = [...linearFormatted, ...githubIssues].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    res.json(allFormatted);
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
      const bdPath = execSync('which bd', { encoding: 'utf-8' }).trim();
      if (bdPath) {
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

            const result = execSync(cmd, { encoding: 'utf-8', cwd: projectPath });
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
            execSync('bd flush', { encoding: 'utf-8', cwd: projectPath });
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
function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
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

// Get git status for a workspace path
function getGitStatus(workspacePath: string): { branch: string; uncommittedFiles: number; latestCommit: string } | null {
  try {
    if (!existsSync(workspacePath)) return null;

    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim();

    const uncommitted = execSync('git status --porcelain 2>/dev/null | wc -l', {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim();

    const latestCommit = execSync('git log -1 --pretty=format:"%s" 2>/dev/null', {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim();

    return {
      branch,
      uncommittedFiles: parseInt(uncommitted) || 0,
      latestCommit: latestCommit.slice(0, 60) + (latestCommit.length > 60 ? '...' : ''),
    };
  } catch {
    return null;
  }
}

// Get running agents from tmux sessions
app.get('/api/agents', async (_req, res) => {
  try {
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_created}" 2>/dev/null || true');

    const agents = stdout
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('agent-'))
      .map((line) => {
        const [name, created] = line.split('|');
        const startedAt = new Date(parseInt(created) * 1000).toISOString();

        // Check agent state from ~/.panopticon/agents/
        const stateFile = join(homedir(), '.panopticon', 'agents', name, 'state.json');
        const healthFile = join(homedir(), '.panopticon', 'agents', name, 'health.json');
        let state: any = { runtime: 'claude', model: 'sonnet', workspace: process.cwd() };
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

        // Get git status for workspace
        const gitStatus = state.workspace ? getGitStatus(state.workspace) : null;

        return {
          id: name,
          issueId: name.replace('agent-', '').toUpperCase(),
          runtime: state.runtime || 'claude',
          model: state.model || 'sonnet',
          status: 'healthy' as const,
          startedAt,
          consecutiveFailures: health.consecutiveFailures || 0,
          killCount: health.killCount || 0,
          workspace: state.workspace || null,
          git: gitStatus,
        };
      });

    res.json(agents);
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
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${id}" -p -S -${lines} 2>/dev/null || echo "Session not found"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    res.json({ output: stdout });
  } catch (error) {
    res.json({ output: 'Failed to capture output' });
  }
});

// Send message to agent
app.post('/api/agents/:id/message', (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Send message to tmux session
    execSync(`tmux send-keys -t "${id}" "${message.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    });
    // Press Enter
    execSync(`tmux send-keys -t "${id}" Enter`, { encoding: 'utf-8' });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Kill agent
app.delete('/api/agents/:id', (req, res) => {
  const { id } = req.params;

  try {
    execSync(`tmux kill-session -t "${id}" 2>/dev/null || true`, {
      encoding: 'utf-8',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error killing agent:', error);
    res.status(500).json({ error: 'Failed to kill agent' });
  }
});

// ============================================================================
// AskUserQuestion Interception Endpoints (PAN-20)
// ============================================================================

// Get pending questions for an agent (polls JSONL for unanswered AskUserQuestion calls)
app.get('/api/agents/:id/pending-questions', (req, res) => {
  const { id } = req.params;

  try {
    const questions = getAgentPendingQuestions(id);
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
app.post('/api/agents/:id/answer-question', (req, res) => {
  const { id } = req.params;
  const { answers } = req.body; // Array of selected option labels

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers array required' });
  }

  try {
    // Format answer text - join multiple selections with comma
    const answerText = answers.join(', ');

    // Send to tmux session (escape quotes in the answer)
    const escapedAnswer = answerText.replace(/"/g, '\\"');
    execSync(`tmux send-keys -t "${id}" "${escapedAnswer}"`, {
      encoding: 'utf-8',
    });
    // Press Enter to submit
    execSync(`tmux send-keys -t "${id}" Enter`, { encoding: 'utf-8' });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending answer:', error);
    res.status(500).json({ error: 'Failed to send answer' });
  }
});

// Check if a tmux session is alive and active
function checkAgentHealth(agentId: string): {
  alive: boolean;
  lastOutput?: string;
  outputAge?: number;
} {
  try {
    // Check if session exists
    execSync(`tmux has-session -t "${agentId}" 2>/dev/null`);

    // Get recent output to check if active
    const output = execSync(
      `tmux capture-pane -t "${agentId}" -p -S -5 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim();

    return { alive: true, lastOutput: output };
  } catch {
    return { alive: false };
  }
}

// Determine health status based on activity
function determineHealthStatus(
  agentId: string,
  stateFile: string
): { status: 'healthy' | 'warning' | 'stuck' | 'dead'; reason?: string } {
  const health = checkAgentHealth(agentId);

  if (!health.alive) {
    return { status: 'dead', reason: 'Session not found' };
  }

  // Check if there's been recent output
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const lastActivity = state.lastActivity ? new Date(state.lastActivity) : null;

      if (lastActivity) {
        const ageMs = Date.now() - lastActivity.getTime();
        const ageMinutes = ageMs / (1000 * 60);

        if (ageMinutes > 30) {
          return { status: 'stuck', reason: `No activity for ${Math.round(ageMinutes)} minutes` };
        } else if (ageMinutes > 15) {
          return { status: 'warning', reason: `Low activity (${Math.round(ageMinutes)} minutes)` };
        }
      }
    } catch {}
  }

  return { status: 'healthy' };
}

// Get agent health status
app.get('/api/health/agents', (_req, res) => {
  try {
    const agentsDir = join(homedir(), '.panopticon', 'agents');
    if (!existsSync(agentsDir)) {
      return res.json([]);
    }

    const agents = readdirSync(agentsDir)
      .filter((name) => name.startsWith('agent-'))
      .map((name) => {
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

        // Check live status
        const { status, reason } = determineHealthStatus(name, stateFile);

        return {
          agentId: name,
          status,
          reason,
          lastPing: new Date().toISOString(),
          consecutiveFailures: storedHealth.consecutiveFailures,
          killCount: storedHealth.killCount,
        };
      });

    res.json(agents);
  } catch (error) {
    console.error('Error fetching health:', error);
    res.json([]);
  }
});

// Ping an agent to check if it's responsive
app.post('/api/health/agents/:id/ping', (req, res) => {
  const { id } = req.params;
  const health = checkAgentHealth(id);

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
app.post('/api/cloister/start', (_req, res) => {
  try {
    const service = getCloisterService();
    service.start();
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

// Get container status for workspace
function getContainerStatus(issueId: string): Record<string, { running: boolean; uptime: string | null }> {
  const issueLower = issueId.toLowerCase();
  // Map display names to possible container suffixes
  const containerMap: Record<string, string[]> = {
    'frontend': ['frontend', 'fe'],  // MYN uses 'fe' for frontend
    'api': ['api'],
    'postgres': ['postgres'],
    'redis': ['redis'],
  };
  const status: Record<string, { running: boolean; uptime: string | null }> = {};

  for (const [displayName, suffixes] of Object.entries(containerMap)) {
    try {
      // Try multiple naming conventions and suffixes
      const patterns: string[] = [];
      for (const suffix of suffixes) {
        patterns.push(
          `myn-feature-${issueLower}-${suffix}-1`,
          `feature-${issueLower}-${suffix}-1`,
          `${issueLower}-${suffix}-1`,
        );
      }

      let found = false;
      for (const containerName of patterns) {
        const output = execSync(
          `docker ps -a --filter "name=${containerName}" --format "{{.Status}}" 2>/dev/null || echo ""`,
          { encoding: 'utf-8' }
        ).trim();

        if (output) {
          const isRunning = output.startsWith('Up');
          const uptime = isRunning ? output.replace(/^Up\s+/, '').split(/\s+/)[0] : null;
          status[displayName] = { running: isRunning, uptime };
          found = true;
          break;
        }
      }

      if (!found) {
        status[displayName] = { running: false, uptime: null };
      }
    } catch {
      status[displayName] = { running: false, uptime: null };
    }
  }

  return status;
}

// Get MR URL for an issue from GitLab
function getMrUrl(issueId: string, workspacePath: string): string | null {
  try {
    // Try to get MR from glab
    const output = execSync(`glab mr list -A -F json 2>/dev/null || echo "[]"`, {
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

// Get git status for sub-repos (frontend/api)
function getRepoGitStatus(workspacePath: string): {
  frontend: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
  api: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
} {
  const result: {
    frontend: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
    api: { branch: string; uncommittedFiles: number; latestCommit: string } | null;
  } = { frontend: null, api: null };

  // Check for both 'fe'/'api' and 'frontend'/'backend' naming conventions
  const repoPaths = [
    { key: 'frontend', paths: ['fe', 'frontend'] },
    { key: 'api', paths: ['api', 'backend'] },
  ];

  for (const { key, paths } of repoPaths) {
    for (const subdir of paths) {
      const repoDir = join(workspacePath, subdir);
      if (!existsSync(repoDir)) continue;

      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim();

        const uncommitted = execSync('git status --porcelain 2>/dev/null | wc -l', {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim();

        const latestCommit = execSync('git log -1 --pretty=format:"%s" 2>/dev/null || echo ""', {
          cwd: repoDir,
          encoding: 'utf-8',
        }).trim();

        result[key as 'frontend' | 'api'] = {
          branch,
          uncommittedFiles: parseInt(uncommitted, 10) || 0,
          latestCommit: latestCommit.slice(0, 60) + (latestCommit.length > 60 ? '...' : ''),
        };
        break; // Found this repo, move to next
      } catch {}
    }
  }

  return result;
}

// Get workspace info for an issue
app.get('/api/workspaces/:issueId', (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Convert issue ID to workspace path (e.g., MIN-645 -> feature-min-645)
  const workspaceName = `feature-${issueLower}`;
  const workspacePath = join(projectPath, 'workspaces', workspaceName);

  if (!existsSync(workspacePath)) {
    return res.json({ exists: false, issueId });
  }

  // Check if workspace is corrupted (exists but not a valid git worktree)
  const gitFile = join(workspacePath, '.git');
  if (!existsSync(gitFile)) {
    return res.json({
      exists: true,
      corrupted: true,
      issueId,
      path: workspacePath,
      message: 'Workspace exists but is not a valid git worktree',
    });
  }

  // Get git status for main workspace and sub-repos
  const git = getGitStatus(workspacePath);
  const repoGit = getRepoGitStatus(workspacePath);

  // Construct service URLs based on workspace naming convention
  const frontendUrl = `https://feature-${issueLower}.myn.test`;
  const apiUrl = `https://api-feature-${issueLower}.myn.test`;

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

  // Get container status
  const containers = hasDocker ? getContainerStatus(issueId) : null;

  // Check if project supports containerization (has new-feature script)
  const canContainerize = !hasDocker && existsSync(join(projectPath, 'infra', 'new-feature'));

  // Get MR URL
  const mrUrl = getMrUrl(issueId, workspacePath);

  // Check for running agent
  let hasAgent = false;
  let agentSessionId: string | null = null;
  let agentModel: string | undefined;

  try {
    const sessions = execSync('tmux list-sessions 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const agentSession = `agent-${issueLower}`;
    if (sessions.includes(agentSession)) {
      hasAgent = true;
      agentSessionId = agentSession;

      // Try to detect model from tmux output
      try {
        const paneOutput = execSync(
          `tmux capture-pane -t "${agentSession}" -p 2>/dev/null | tail -50`,
          { encoding: 'utf-8' }
        );
        const modelMatch = paneOutput.match(/\[(Opus|Sonnet|Haiku)[^\]]*\]/i);
        agentModel = modelMatch ? modelMatch[1] : undefined;
      } catch {}
    }
  } catch {}

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
    git,
    repoGit,
    services,
    containers,
    hasDocker,
    canContainerize,
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
app.get('/api/workspaces/:issueId/clean/preview', (req, res) => {
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
    const filesOutput = execSync(findCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    const files = filesOutput ? filesOutput.split('\n').map(f => f.replace(workspacePath + '/', '')) : [];

    // Get total size (excluding node_modules etc)
    let totalSize = '0';
    try {
      const duCmd = `du -sh "${workspacePath}" --exclude=node_modules --exclude=target --exclude=dist --exclude=.git 2>/dev/null | cut -f1`;
      totalSize = execSync(duCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim() || '0';
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
            execSync(`git rev-parse --verify ${branchName} 2>/dev/null`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            compareRef = branchName;
          } catch {
            // Try master if main doesn't exist
            try {
              execSync(`git rev-parse --verify main 2>/dev/null`, { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            } catch {
              compareRef = 'master';
            }
          }

          // Try to get file content from git
          const gitContent = execSync(
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
app.post('/api/workspaces/:issueId/clean', (req, res) => {
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
      execSync(
        `rsync -a --quiet --exclude=node_modules --exclude=target --exclude=dist --exclude=.git --exclude=__pycache__ --exclude=.cache --exclude=.next --exclude=coverage "${workspacePath}/" "${backupPath}/"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      );
    }

    // Remove the corrupted workspace directory
    // If regular rm fails (files owned by root from Docker), use Docker to clean up
    console.log(`Removing corrupted workspace: ${workspacePath}`);
    try {
      execSync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: 'pipe' });
    } catch (rmError: any) {
      console.log('Regular rm failed, using Docker to clean up root-owned files...');
      // Use Alpine container to remove contents as root inside Docker (no sudo needed on host)
      // Note: Can't remove /cleanup itself (mount point), so remove contents then rmdir from host
      execSync(
        `docker run --rm -v "${workspacePath}:/cleanup" alpine sh -c "rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: 'pipe' }
      );
      // Now remove the empty directory from host
      execSync(`rmdir "${workspacePath}"`, { encoding: 'utf-8', stdio: 'pipe' });
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
app.post('/api/workspaces/:issueId/containerize', (req, res) => {
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
    execSync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
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
      execSync(`pan workspace destroy ${issueId} --force 2>/dev/null || true`, {
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
app.post('/api/workspaces/:issueId/start', (req, res) => {
  const { issueId } = req.params;
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  // Check workspace exists
  if (!existsSync(workspacePath)) {
    return res.status(400).json({ error: 'Workspace does not exist' });
  }

  // Check for ./dev script
  const devScript = join(workspacePath, 'dev');
  if (!existsSync(devScript)) {
    return res.status(400).json({ error: 'Workspace has no ./dev script' });
  }

  // Check if Docker is running
  try {
    execSync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
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

// Approve workspace: merge, update Linear, clean up
// SAFETY: Never delete remote branches. Always push before cleanup. Abort on any error.
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

  try {
    // 1. Check workspace exists
    if (!existsSync(workspacePath)) {
      return res.status(400).json({ error: 'Workspace does not exist' });
    }

    // 2. Verify the feature branch exists
    try {
      execSync(`git rev-parse --verify ${branchName}`, { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      return res.status(400).json({ error: `Branch ${branchName} does not exist` });
    }

    // 3. Check for uncommitted changes in workspace before proceeding
    try {
      const status = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' });
      if (status.trim()) {
        return res.status(400).json({
          error: `Workspace has uncommitted changes. Please commit or stash them first:\ncd ${workspacePath}\ngit status`
        });
      }
    } catch (statusErr) {
      // If we can't check status, continue but log it
      console.warn('Could not check workspace status:', statusErr);
    }

    // 4. Push the feature branch to remote BEFORE merging (preserve work)
    try {
      execSync(`git push origin ${branchName}`, { cwd: workspacePath, encoding: 'utf-8', stdio: 'pipe' });
      console.log(`Pushed ${branchName} to remote`);
    } catch (pushErr: any) {
      // If push fails, it might already be up to date - that's okay
      console.log(`Feature branch push note: ${pushErr.message}`);
    }

    // 5. Switch to main and pull latest
    try {
      execSync('git checkout main', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
      // Use explicit origin main to avoid tracking branch issues in worktrees
      execSync('git pull origin main --ff-only', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
    } catch (checkoutErr: any) {
      return res.status(400).json({
        error: `Failed to checkout/update main branch: ${checkoutErr.message}`
      });
    }

    // 6. Try to merge the feature branch
    try {
      execSync(`git merge ${branchName} --no-edit`, { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
      mergeCompleted = true;
      console.log(`Merged ${branchName} to main`);
    } catch (mergeError: any) {
      // Abort the merge if there was a conflict
      try {
        execSync('git merge --abort', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
      } catch {}
      return res.status(400).json({
        error: `Merge conflict! Please resolve manually:\ncd ${projectPath}\ngit merge ${branchName}`
      });
    }

    // 7. CRITICAL: Push merged main to remote BEFORE any cleanup
    try {
      execSync('git push origin main', { cwd: projectPath, encoding: 'utf-8', stdio: 'pipe' });
      pushCompleted = true;
      console.log('Pushed merged main to remote');
    } catch (pushErr: any) {
      // CRITICAL: If push fails, DO NOT proceed with cleanup
      return res.status(400).json({
        error: `Merge succeeded but push failed! Your work is safe locally.\nPlease push manually: cd ${projectPath} && git push origin main\nError: ${pushErr.message}`
      });
    }

    // 8. Stop any running agent
    const agentId = `agent-${issueLower}`;
    try {
      execSync(`tmux has-session -t ${agentId} 2>/dev/null && tmux kill-session -t ${agentId}`, {
        encoding: 'utf-8',
        shell: '/bin/bash'
      });
      console.log(`Stopped agent ${agentId}`);
    } catch {
      // Agent not running, that's fine
    }

    // 9. Remove the workspace (git worktree) - ONLY after successful push
    try {
      execSync(`git worktree remove workspaces/feature-${issueLower} --force`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: 'pipe'
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
        execSync('pan sync', { encoding: 'utf-8', timeout: 30000 });
        console.log('pan sync completed');
      } catch (syncError: any) {
        console.error('pan sync failed (non-fatal):', syncError.message);
        // Don't fail the approve - sync failure is non-fatal
      }
    }

    // Record task metrics for the completed work
    recordApprovedTask(issueId, workspacePath, 'success');

    res.json({
      success: true,
      message: `Approved ${issueId}: merged, workspace removed, issue closed${isGitHubIssue || issueId.toUpperCase().startsWith('PAN-') ? ', skills synced' : ''}, metrics recorded`,
    });
  } catch (error: any) {
    console.error('Error approving workspace:', error);
    res.status(500).json({ error: 'Failed to approve: ' + error.message });
  }
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
        execSync(`gh issue close ${number} --repo ${repoPath} --reason completed`, {
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
      execSync(`tmux has-session -t ${agentId} 2>/dev/null && tmux kill-session -t ${agentId}`, {
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
        execSync(`git worktree remove workspaces/feature-${issueLower} --force`, {
          cwd: projectPath,
          encoding: 'utf-8'
        });
        console.log(`Removed workspace for ${issueId}`);
      } catch (wtError: any) {
        console.error('Error removing worktree:', wtError.message);
      }
    }

    // 4. Delete feature branch if it exists
    try {
      execSync(`git branch -d ${branchName} 2>/dev/null || git branch -D ${branchName} 2>/dev/null || true`, {
        cwd: projectPath,
        encoding: 'utf-8',
        shell: '/bin/bash'
      });
    } catch {}

    // 5. Run pan sync for Panopticon issues
    if (isGitHubIssue) {
      try {
        execSync('pan sync', { encoding: 'utf-8', timeout: 30000 });
        console.log('pan sync completed');
      } catch {}
    }

    res.json({
      success: true,
      message: `Closed ${issueId}${reason ? ': ' + reason : ''}`,
    });
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

  try {
    // Extract prefix from issue ID (e.g., "MIN" from "MIN-645")
    const issuePrefix = issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);
    const issueLower = issueId.toLowerCase();

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
        execSync(`git add .planning/`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
        // Also add .beads/ if it exists
        if (existsSync(join(gitRoot, '.beads'))) {
          execSync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
        }
        // Also add STATE.md and WORKSPACE.md if they exist
        if (existsSync(join(gitRoot, 'STATE.md'))) {
          execSync(`git add STATE.md`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
        }
        if (existsSync(join(gitRoot, 'WORKSPACE.md'))) {
          execSync(`git add WORKSPACE.md`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
        }

        // Check if there are changes to commit
        try {
          execSync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
          // No changes to commit
          console.log(`No planning changes to commit for ${issueId}`);
        } catch (diffErr) {
          // There are changes, commit and push them
          execSync(`git commit -m "Planning artifacts for ${issueId} before agent start"`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
          execSync(`git push`, { cwd: gitRoot, encoding: 'utf-8', stdio: 'pipe' });
          console.log(`Committed and pushed planning artifacts for ${issueId}`);
        }
      } catch (gitErr) {
        console.error('Git commit/push of planning artifacts failed:', gitErr);
        // Continue even if git fails - don't block agent start
      }
    }

    const activityId = spawnPanCommand(
      ['work', 'issue', issueId],
      `Start agent for ${issueId}`,
      projectPath
    );

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

    // Also start containers if workspace has ./dev script
    let containerActivityId: string | null = null;
    const devScript = join(workspacePath, 'dev');

    if (existsSync(workspacePath) && existsSync(devScript)) {
      // Check if Docker is running
      let dockerRunning = false;
      try {
        execSync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
        dockerRunning = true;
      } catch {
        console.log('Docker not running, skipping container start');
      }

      if (dockerRunning) {
        containerActivityId = `containers-${Date.now()}`;

        logActivity({
          id: containerActivityId,
          timestamp: new Date().toISOString(),
          command: `./dev all (${issueId})`,
          status: 'running',
          output: [],
        });

        // Pass UID/GID for correct file ownership in containers
        const containerUid = process.getuid?.() ?? 1000;
        const containerGid = process.getgid?.() ?? 1000;
        const containerChild = spawn('./dev', ['all'], {
          cwd: workspacePath,
          detached: true,
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
        });

        containerChild.on('error', (err) => {
          appendActivityOutput(containerActivityId!, `[error] ${err.message}`);
          updateActivity(containerActivityId!, { status: 'failed' });
        });

        console.log(`Starting containers for ${issueId} in ${workspacePath}`);
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
  const { skipWorkspace = false } = req.body;

  try {
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
      await addGitHubPlanningLabel(githubCheck.owner, githubCheck.repo, githubCheck.number);
      newStateName = 'Planning (label added)';

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

    if (!skipWorkspace) {
      try {
        if (!existsSync(workspacePath)) {
          // Create workspace using pan workspace create (git worktree only, no docker)
          const activityId = Date.now().toString();
          logActivity({
            id: activityId,
            timestamp: new Date().toISOString(),
            command: `pan workspace create ${issue.identifier}`,
            status: 'running',
            output: [],
          });

          // Run pan workspace create
          execSync(`pan workspace create ${issue.identifier}`, {
            cwd: projectPath,
            encoding: 'utf-8',
            timeout: 60000,
          });
          workspaceCreated = true;
          appendActivityOutput(activityId, 'Workspace created successfully');
        } else {
          workspaceCreated = true; // Already exists
        }
      } catch (err: any) {
        workspaceError = err.message;
        console.error('Workspace creation error:', err);
      }
    }

    // 5. Spawn planning agent in tmux
    const sessionName = `planning-${issueLower}`;
    let planningAgentStarted = false;
    let planningAgentError: string | undefined;

    try {
      // Kill existing planning session if any
      execSync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

      // Create planning prompt file - store IN workspace if exists (for git-backed planning)
      const planningDir = workspaceCreated
        ? join(workspacePath, '.planning')
        : join(projectPath, '.planning', issueLower);
      if (!existsSync(planningDir)) {
        execSync(`mkdir -p "${planningDir}"`, { encoding: 'utf-8' });
      }

      const planningPromptPath = join(planningDir, 'PLANNING_PROMPT.md');
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

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Create beads tasks with dependencies using \`bd create\`
3. Summarize the plan and STOP

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
`;

      writeFileSync(planningPromptPath, planningPrompt);

      // Determine working directory - use workspace if created, otherwise project root
      const agentCwd = workspaceCreated ? workspacePath : projectPath;

      // Start tmux session with Claude Code for planning (interactive TUI mode)
      // Just start Claude interactively - the prompt file is in the workspace for reference
      const claudeCommand = `cd "${agentCwd}" && claude --dangerously-skip-permissions`;

      // Ensure tmux is running before starting session
      ensureTmuxRunning();
      execSync(`tmux new-session -d -s ${sessionName} "${claudeCommand}"`, { encoding: 'utf-8' });

      // Resize the tmux window to be wide enough for Claude's TUI
      try {
        execSync(`tmux resize-window -t ${sessionName} -x 200 -y 50 2>/dev/null`, { encoding: 'utf-8' });
      } catch {
        // Ignore resize errors
      }

      // Wait for Claude to initialize, then send the planning prompt
      setTimeout(() => {
        try {
          // Send a short message that tells Claude to read the prompt file
          const initMessage = `Please read the planning prompt file at ${planningPromptPath} and begin the planning session for ${issue.identifier}: ${issue.title}`;
          // Escape special characters for tmux send-keys
          const escapedMessage = initMessage.replace(/'/g, "'\\''");
          // Send text followed by Enter in single atomic command
          execSync(`tmux send-keys -t ${sessionName} '${escapedMessage}' Enter`, { encoding: 'utf-8' });
          console.log(`Sent planning prompt to ${sessionName}`);
        } catch (err) {
          console.error('Failed to send planning prompt:', err);
        }
      }, 6000); // Wait 6 seconds for Claude to fully initialize (TUI takes time)

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
app.get('/api/planning/:issueId/status', (req, res) => {
  const { issueId } = req.params;
  const sessionName = `planning-${issueId.toLowerCase()}`;
  const issueLower = issueId.toLowerCase();
  const issuePrefix = issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  try {
    // Check if tmux session exists
    const sessions = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""', {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);

    const sessionExists = sessions.includes(sessionName);

    res.json({
      active: sessionExists,
      sessionName,
      workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
    });
  } catch (error: any) {
    res.json({
      active: false,
      sessionName,
      workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
      error: error.message,
    });
  }
});

// Send message to planning session - starts a new Claude run with context
app.post('/api/planning/:issueId/message', async (req, res) => {
  const { issueId } = req.params;
  const { message } = req.body;
  const sessionName = `planning-${issueId.toLowerCase()}`;
  const issueLower = issueId.toLowerCase();

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    // Kill any existing session first (Claude with --print will have exited anyway)
    try {
      execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
    } catch (e) {
      // Session might not exist
    }

    // Find planning directory - check workspace first, then legacy
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

    const outputFile = join(planningDir, 'output.jsonl');

    // Read previous output to get FULL context
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

    // Backup old output and start new session
    if (existsSync(outputFile)) {
      const backupPath = join(planningDir, `output-${Date.now()}.jsonl`);
      renameSync(outputFile, backupPath);
    }

    const claudeCommand = `cd "${agentCwd}" && claude --dangerously-skip-permissions --print --verbose --output-format stream-json -p "${continuationPromptPath}" 2>&1 | tee "${outputFile}"`;

    ensureTmuxRunning();
    execSync(`tmux new-session -d -s ${sessionName} "${claudeCommand}"`, { encoding: 'utf-8' });

    res.json({ success: true, sessionName, message: 'Planning session continued' });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
});

// Stop planning session (kills tmux session)
app.delete('/api/planning/:issueId', (req, res) => {
  const { issueId } = req.params;
  const sessionName = `planning-${issueId.toLowerCase()}`;

  try {
    // Kill tmux session
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

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
  const sessionName = `planning-${id.toLowerCase()}`;

  try {
    // Check if this is a GitHub issue
    const githubCheck = isGitHubIssue(id);

    let revertedState = 'Todo';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
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
        // Fetch issue to get team
        const issueQuery = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
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

    // Kill the tmux session
    execSync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });

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
        } else {
          // For Linear issues, we need to find the project path
          // Check project mappings
          const mappingsPath = join(homedir(), '.panopticon', 'project-mappings.json');
          if (existsSync(mappingsPath)) {
            const mappings = JSON.parse(readFileSync(mappingsPath, 'utf-8'));
            // Try to match by issue prefix (e.g., MIN-123 -> MIN)
            const prefix = id.split('-')[0];
            const mapping = mappings.find((m: any) => m.linearPrefix === prefix);
            if (mapping) {
              projectPath = mapping.localPath;
            }
          }
        }

        if (projectPath) {
          const workspacePath = join(projectPath, 'workspaces', id.toLowerCase());

          if (existsSync(workspacePath)) {
            // Remove the git worktree
            execSync(`git worktree remove "${workspacePath}" --force`, {
              cwd: projectPath,
              encoding: 'utf-8',
            });
            workspaceDeleted = true;
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
    // Kill any running planning session
    try {
      execSync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
    } catch (e) {
      // Session might not exist
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

    // Git commit and push if planning dir exists
    let gitPushed = false;
    if (projectPath) {
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

          // Git add planning and beads directories
          execSync(`git add .planning/`, { cwd: gitRoot, encoding: 'utf-8' });
          // Also add .beads/ if it exists (planning may create beads tasks)
          if (existsSync(join(gitRoot, '.beads'))) {
            execSync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' });
          }

          // Check if there are changes to commit
          try {
            execSync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' });
            // No changes to commit
          } catch (diffErr) {
            // There are changes, commit them
            execSync(`git commit -m "Complete planning for ${id}"`, { cwd: gitRoot, encoding: 'utf-8' });
          }

          // Push to remote
          execSync(`git push`, { cwd: gitRoot, encoding: 'utf-8' });
          gitPushed = true;
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

// Get beads tasks for an issue
app.get('/api/issues/:id/beads', (req, res) => {
  const { id } = req.params;
  const issueLower = id.toLowerCase();

  try {
    // Find project path
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

    if (!projectPath) {
      return res.json({ tasks: [], message: 'No project found' });
    }

    // Read STATE.md to get beads IDs created during planning
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const statePath = join(workspacePath, '.planning', 'STATE.md');
    const beadsIds: string[] = [];

    if (existsSync(statePath)) {
      const stateContent = readFileSync(statePath, 'utf-8');
      // Extract beads IDs from STATE.md (format: `panopticon-xxx` or similar)
      const idMatches = stateContent.match(/`([a-z]+-[a-z0-9]+)`/g) || [];
      for (const match of idMatches) {
        const beadsId = match.replace(/`/g, '');
        if (beadsId.includes('-') && !beadsId.includes('/')) {
          beadsIds.push(beadsId);
        }
      }
    }

    // Check both workspace beads and main project beads
    const beadsPaths = [
      join(workspacePath, '.beads', 'issues.jsonl'),
      join(projectPath, '.beads', 'issues.jsonl'),
    ];

    const tasks: any[] = [];
    const seenIds = new Set<string>();

    for (const issuesFile of beadsPaths) {
      if (!existsSync(issuesFile)) continue;

      const content = readFileSync(issuesFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const issue = JSON.parse(line);
          // Skip if already seen
          if (seenIds.has(issue.id)) continue;

          // Include if: ID is in our beadsIds list, OR tagged with issue identifier
          const tags = issue.tags || [];
          const matchesTag = tags.some((t: string) =>
            t.toLowerCase() === issueLower || t.toLowerCase() === id.toLowerCase()
          );
          const matchesBeadsId = beadsIds.includes(issue.id);

          if (matchesTag || matchesBeadsId) {
            seenIds.add(issue.id);
            tasks.push({
              id: issue.id,
              title: issue.title,
              status: issue.status,
              type: issue.issue_type || issue.type,
              blockedBy: issue.blocked_by || [],
              createdAt: issue.created_at,
            });
          }
        } catch (e) {
          // Skip malformed lines
        }
      }
    }

    // Sort by creation date
    tasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    res.json({
      tasks,
      workspacePath,
      count: tasks.length,
    });
  } catch (error: any) {
    console.error('Error fetching beads:', error);
    res.status(500).json({ error: 'Failed to fetch beads: ' + error.message });
  }
});

// ============== Cost & Metrics API ==============

// Cost tracking imports (inline to avoid external module issues)
const COSTS_DIR = join(homedir(), '.panopticon', 'costs');
const SESSION_MAP_FILE = join(homedir(), '.panopticon', 'session-map.json');
const METRICS_FILE = join(homedir(), '.panopticon', 'runtime-metrics.json');

// Model pricing data
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number; cacheReadPer1k?: number; cacheWritePer1k?: number }> = {
  'claude-opus-4': { inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 0.00175, cacheWritePer1k: 0.01875 },
  'claude-sonnet-4': { inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWritePer1k: 0.00375 },
  'claude-haiku-3.5': { inputPer1k: 0.0008, outputPer1k: 0.004, cacheReadPer1k: 0.00008, cacheWritePer1k: 0.001 },
};

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

// Parse Claude Code session files for a workspace and return aggregated usage
function parseWorkspaceSessionUsage(workspacePath: string): {
  tokenCount: number;
  cost: number;
  model: string;
  startTime: string | null;
  endTime: string | null;
} {
  // Claude Code session directory name format: path with / replaced by -
  // e.g., /home/eltmon/projects/foo -> -home-eltmon-projects-foo
  const sessionDirName = workspacePath.replace(/\//g, '-');
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
    const files = readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = join(sessionDir, file);
      const content = readFileSync(filePath, 'utf-8');
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

    // Calculate cost based on model pricing
    let pricing = MODEL_PRICING['claude-sonnet-4']; // default
    if (model.includes('opus')) {
      pricing = MODEL_PRICING['claude-opus-4'];
    } else if (model.includes('haiku')) {
      pricing = MODEL_PRICING['claude-haiku-3.5'];
    }

    const cost =
      (totalInputTokens / 1000) * pricing.inputPer1k +
      (totalOutputTokens / 1000) * pricing.outputPer1k +
      (totalCacheReadTokens / 1000) * (pricing.cacheReadPer1k || 0) +
      (totalCacheWriteTokens / 1000) * (pricing.cacheWritePer1k || 0);

    const tokenCount = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens;

    console.log(`Parsed session usage for ${workspacePath}: ${tokenCount} tokens, $${cost.toFixed(4)}`);

    return { tokenCount, cost, model, startTime, endTime };
  } catch (err) {
    console.error('Error parsing session files:', err);
    return { tokenCount: 0, cost: 0, model, startTime: null, endTime: null };
  }
}

// Record a completed task in runtime metrics
function recordApprovedTask(issueId: string, workspacePath: string, outcome: 'success' | 'failure' | 'partial'): void {
  try {
    const usage = parseWorkspaceSessionUsage(workspacePath);
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

// GET /api/costs/by-issue - Costs grouped by issue
app.get('/api/costs/by-issue', (_req, res) => {
  try {
    // Merge data from both session-map (legacy) and runtime-metrics (new)
    const sessionMap = loadSessionMap();
    const runtimeMetrics = loadRuntimeMetrics();
    const issueMap: Record<string, { totalCost: number; tokenCount: number; sessionCount: number; model?: string; durationMinutes?: number }> = {};

    // Add from session-map (legacy format)
    for (const [issueId, issueData] of Object.entries(sessionMap.issues || {})) {
      const data = issueData as any;
      const key = issueId.toLowerCase();
      issueMap[key] = {
        totalCost: data.totalCost || 0,
        tokenCount: data.totalTokens || 0,
        sessionCount: data.sessions?.length || 0,
      };
    }

    // Add/merge from runtime-metrics (new format with tasks)
    for (const task of runtimeMetrics.tasks || []) {
      if (task.issueId) {
        const key = task.issueId.toLowerCase();
        if (!issueMap[key]) {
          issueMap[key] = { totalCost: 0, tokenCount: 0, sessionCount: 0 };
        }
        // If this is a new entry or has more data, update it
        if (task.cost > issueMap[key].totalCost) {
          issueMap[key].totalCost = task.cost;
          issueMap[key].tokenCount = task.tokenCount;
          issueMap[key].model = task.model;
          issueMap[key].durationMinutes = task.durationMinutes;
        }
        issueMap[key].sessionCount = Math.max(issueMap[key].sessionCount, 1);
      }
    }

    // Convert to array
    const issues = Object.entries(issueMap).map(([issueId, data]) => ({
      issueId: issueId.toUpperCase(),
      totalCost: data.totalCost,
      tokenCount: data.tokenCount,
      sessionCount: data.sessionCount,
      model: data.model,
      durationMinutes: data.durationMinutes,
    }));

    // Sort by cost descending
    issues.sort((a, b) => b.totalCost - a.totalCost);

    res.json({ issues });
  } catch (error: any) {
    console.error('Error getting costs by issue:', error);
    res.status(500).json({ error: 'Failed to get costs by issue: ' + error.message });
  }
});

// GET /api/issues/:id/costs - Cost summary for a specific issue
app.get('/api/issues/:id/costs', (req, res) => {
  try {
    const { id } = req.params;
    const sessionMap = loadSessionMap();
    const issueData = sessionMap.issues?.[id] || sessionMap.issues?.[id.toUpperCase()];

    if (!issueData) {
      // Try to find by searching (case-insensitive)
      const issueKey = Object.keys(sessionMap.issues || {}).find(
        k => k.toLowerCase() === id.toLowerCase()
      );
      if (!issueKey) {
        return res.json({
          issueId: id,
          totalCost: 0,
          totalTokens: 0,
          sessions: [],
          byModel: {},
        });
      }
    }

    const data = issueData || { sessions: [], totalCost: 0, totalTokens: 0 };

    // Calculate by-model breakdown
    const byModel: Record<string, number> = {};
    for (const session of data.sessions || []) {
      const model = session.model || 'unknown';
      byModel[model] = (byModel[model] || 0) + (session.cost || 0);
    }

    res.json({
      issueId: id,
      totalCost: data.totalCost || 0,
      totalTokens: data.totalTokens || 0,
      sessions: data.sessions || [],
      byModel,
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
ensureTmuxRunning();

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

// Track active PTY sessions
const activePtys = new Map<string, pty.IPty>();

// Health check endpoint (must be after wss and activePtys are defined)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: {
      websockets: wss.clients.size,
      activePtys: activePtys.size
    }
  });
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

  // Check if tmux session exists (async to avoid blocking event loop)
  (async () => {
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""');
      const sessions = stdout.trim().split('\n').filter(Boolean);

      if (!sessions.includes(sessionName)) {
        ws.close(1008, `Session ${sessionName} not found`);
        return;
      }
    } catch {
      ws.close(1008, 'Failed to list tmux sessions');
      return;
    }

    // Spawn a PTY that attaches to the tmux session
    // The PTY will receive the full screen content including alternate buffer
    // Initial dimensions match frontend xterm.js (120x30) to avoid resize flicker
    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' } as { [key: string]: string },
    });

    // Pre-resize tmux window to match initial PTY dimensions
    execAsync(`tmux resize-window -t ${sessionName} -x 120 -y 30 2>/dev/null || true`)
      .catch(() => { /* ignore initial resize errors */ });

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

    // Forward WebSocket input to PTY
    ws.on('message', (data) => {
      const message = data.toString();

      // Handle resize messages (JSON format: {"type":"resize","cols":80,"rows":24})
      // Only attempt JSON parse if message looks like JSON (starts with '{')
      if (message.startsWith('{')) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            // Resize tmux window FIRST, then PTY (order matters for proper sync)
            // tmux resize triggers SIGWINCH which the application uses to redraw
            execAsync(`tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} 2>/dev/null || true`)
              .then(() => {
                ptyProcess.resize(parsed.cols, parsed.rows);
              })
              .catch(() => {
                // Still resize PTY even if tmux resize fails
                ptyProcess.resize(parsed.cols, parsed.rows);
              });
            return;
          }
        } catch {
          // Invalid JSON, treat as terminal input
        }
      }

      ptyProcess.write(message);
    });

    // Clean up on WebSocket close
    ws.on('close', () => {
      console.log(`WebSocket closed for session: ${sessionName}`);
      // Detach from tmux (Ctrl-b d) before killing PTY to leave tmux session running
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Panopticon API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket terminal available at ws://0.0.0.0:${PORT}/ws/terminal`);
});
