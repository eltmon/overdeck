/**
 * `pan machines who <issue> [--json]` (PAN-4651 FR-5, D-4651-16): which
 * machines run agents or conversations for an issue. Reads
 * `GET /api/fleet/issues/:id/activity` (this machine plus every online linked
 * machine) and prints `MACHINE  KIND  ID  STATUS`.
 */
import type { Command } from 'commander';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { NOT_RUNNING } from './machines-call.js';

interface MachineActivity {
  environmentId: string;
  label: string;
  self: boolean;
  agents: Array<{ id: string; status: string }>;
  conversations: Array<{ name: string; isWorking: boolean }>;
  error?: string;
}

export interface WhoDeps {
  call: (path: string) => Promise<{ status: number; json: unknown }>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultDeps = (): WhoDeps => ({
  call: async (path) => {
    const response = await callDashboard(path, { method: 'GET' });
    if (!response.ok) return { status: response.status, json: { error: await errorText(response) } };
    return { status: response.status, json: await response.json().catch(() => null) };
  },
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});

/** The table rows, this machine first. */
export function whoRows(machines: readonly MachineActivity[]): string[][] {
  const rows: string[][] = [];
  for (const machine of machines) {
    for (const agent of machine.agents) rows.push([machine.label, 'agent', agent.id, agent.status]);
    for (const conversation of machine.conversations) rows.push([machine.label, 'conversation', conversation.name, conversation.isWorking ? 'working' : 'idle']);
  }
  return rows;
}

export async function runMachinesWho(issue: string, options: { json?: boolean }, deps: WhoDeps = defaultDeps()): Promise<number> {
  const issueId = issue.toUpperCase();
  let answer: { status: number; json: unknown };
  try {
    answer = await deps.call(`/api/fleet/issues/${encodeURIComponent(issueId)}/activity`);
  } catch (error) {
    deps.stderr(isDashboardUnreachable(error) ? NOT_RUNNING : (error as Error).message);
    return 1;
  }
  if (answer.status !== 200) {
    deps.stderr(`pan machines who failed: ${String((answer.json as { error?: unknown } | null)?.error ?? `HTTP ${answer.status}`)}`);
    return 1;
  }
  if (options.json) {
    deps.stdout(JSON.stringify(answer.json));
    return 0;
  }
  const machines = ((answer.json as { machines?: MachineActivity[] } | null)?.machines ?? []);
  const rows = whoRows(machines);
  if (rows.length === 0) deps.stdout(`No machine runs an agent or conversation for ${issueId}.`);
  else {
    const table = [['MACHINE', 'KIND', 'ID', 'STATUS'], ...rows];
    const widths = table[0]!.map((_, column) => Math.max(...table.map((cells) => cells[column]!.length)));
    for (const cells of table) deps.stdout(cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());
  }
  for (const machine of machines) if (machine.error) deps.stderr(`${machine.label}: ${machine.error}`);
  return 0;
}

export function registerMachinesWhoCommand(machines: Command): void {
  machines
    .command('who <issue>')
    .description('Show which machines run agents or conversations for an issue')
    .option('--json', 'Print the fleet answer as JSON')
    .action(async (issue: string, options: { json?: boolean }) => {
      const code = await runMachinesWho(issue, options);
      const { exitCli } = await import('../exit.js');
      await exitCli(code);
    });
}
