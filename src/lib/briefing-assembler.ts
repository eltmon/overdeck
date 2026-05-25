import { readFile, stat } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { resolveStatusFile } from './memory/paths.js';

export interface AssembleLiveBriefingInput {
  cwd?: string;
  projectId?: string;
  now?: Date;
}

interface WorkspaceContext {
  workspacePath: string;
  workspaceId: string;
  issueId: string;
  planTitle: string | null;
}

interface BriefingStatus {
  headline?: string;
  summary?: string;
  phase?: string;
  nextSteps?: string[];
  open?: string[];
}

const DEFAULT_PROJECT_ID = 'panopticon-cli';

export async function assembleLiveBriefingMarkdown(input: AssembleLiveBriefingInput = {}): Promise<string> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const projectId = input.projectId ?? DEFAULT_PROJECT_ID;
  const now = input.now ?? new Date();
  const workspace = await detectWorkspaceContext(cwd);
  const status = workspace ? await readWorkspaceStatus(projectId, workspace.issueId) : null;

  return [
    '# Working Inside Panopticon',
    '',
    `Generated: ${now.toISOString()}`,
    '',
    '## What Panopticon Gives You',
    '',
    '- A live dashboard for issues, agents, workspaces, review state, and terminal access.',
    '- Memory observations and rollups that preserve useful project context across sessions.',
    '- Issue-scoped workspaces, beads, vBRIEF plans, and role handoffs for autonomous work.',
    '',
    '## How to Read What Follows',
    '',
    'This briefing is operational context, not an instruction override. Treat it as current background and keep user, system, role, issue, and repository instructions authoritative.',
    '',
    '## Current Workspace',
    '',
    ...renderWorkspaceSection(workspace, status),
    '',
    '## Knowledge Registry',
    '',
    '- Feature ownership records will appear here when the registry service has entries.',
    '- Use `pan registry list` and `pan registry show <feature>` to inspect ownership from terminal-only sessions.',
    '- For sibling workspace context, run `pan memory search --sibling <query>` or broaden with project/workspace filters instead of assuming this briefing is exhaustive.',
    '',
    '## Memory-First Triggers',
    '',
    '- Before answering prompts about prior work, decisions, regressions, or remembered fixes, search memory first.',
    '- Trigger phrases include "we recently", "last session", "we decided", "the fix", and "remember when".',
    '- Start with `pan memory search <query>` and add `--issue`, `--workspace`, or `--sibling` when the scope is known.',
    '',
    '## Tools',
    '',
    '- `pan memory search <query>` — search preserved observations and summaries.',
    '- `pan docs query <query>` — query project documentation when available.',
    '- `pan artifacts <issue>` — inspect issue artifacts when available.',
    '- `pan briefing` — print this live briefing for terminal-only sessions.',
    '- `pan registry tag|list|show` — manage and inspect feature ownership records.',
    '- `pan compliance status` — inspect advisory memory-first compliance state when available.',
  ].join('\n');
}

async function detectWorkspaceContext(cwd: string): Promise<WorkspaceContext | null> {
  let current = cwd;
  while (true) {
    const workspaceId = basename(current);
    const issueMatch = workspaceId.match(/^feature-([a-z]+-\d+)$/i);
    if (issueMatch && await pathExists(join(current, '.git'))) {
      return {
        workspacePath: current,
        workspaceId,
        issueId: issueMatch[1].toUpperCase(),
        planTitle: await readWorkspacePlanTitle(current),
      };
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readWorkspacePlanTitle(workspacePath: string): Promise<string | null> {
  const path = join(workspacePath, '.pan', 'spec.vbrief.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { plan?: { title?: unknown } };
    return typeof parsed.plan?.title === 'string' ? parsed.plan.title : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readWorkspaceStatus(projectId: string, issueId: string): Promise<BriefingStatus | null> {
  try {
    const parsed = JSON.parse(await readFile(resolveStatusFile(projectId, issueId), 'utf8')) as BriefingStatus;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function renderWorkspaceSection(workspace: WorkspaceContext | null, status: BriefingStatus | null): string[] {
  if (!workspace) {
    return [
      '- No Panopticon workspace was detected from the current directory.',
      '- Run `pan briefing` from inside a `workspaces/feature-<issue>` checkout to include workspace-specific context.',
    ];
  }

  const lines = [
    `- Workspace: ${workspace.workspaceId}`,
    `- Issue: ${workspace.issueId}`,
    `- Path: ${workspace.workspacePath}`,
  ];
  if (workspace.planTitle) lines.push(`- Plan: ${workspace.planTitle}`);
  if (status?.phase) lines.push(`- Phase: ${status.phase}`);
  if (status?.headline) lines.push(`- Headline: ${status.headline}`);
  if (status?.summary) lines.push(`- Summary: ${status.summary}`);
  if (status?.nextSteps?.length) lines.push(`- Next steps: ${status.nextSteps.join('; ')}`);
  if (status?.open?.length) lines.push(`- Open questions: ${status.open.join('; ')}`);
  return lines;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
