import { Command } from 'commander';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../lib/internal-token.js';

function dashboardBaseUrl(): string {
  return (process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string') return payload.error;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) return text.trim();
    } catch {
      return `Dashboard returned HTTP ${response.status}`;
    }
  }
  return `Dashboard returned HTTP ${response.status}`;
}

export async function mergeCancelCommand(issueId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const normalizedIssueId = issueId.trim().toUpperCase();
  try {
    if (!normalizedIssueId) throw new Error('Issue ID is required');

    const res = await fetchImpl(`${dashboardBaseUrl()}/api/flywheel/auto-merge/${encodeURIComponent(normalizedIssueId)}`, {
      method: 'DELETE',
      headers: {
        [INTERNAL_TOKEN_HEADER]: ensureInternalTokenSync(),
      },
    });

    if (res.ok) {
      console.log(`Cancelled auto-merge for ${normalizedIssueId}`);
      return;
    }

    console.error(await readErrorMessage(res));
    process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function registerMergeCommands(program: Command): void {
  const merge = program
    .command('merge')
    .description('Merge workflow helpers');

  merge
    .command('cancel <id>')
    .description('Cancel a pending Flywheel auto-merge during its cooldown window')
    .action(mergeCancelCommand);
}
