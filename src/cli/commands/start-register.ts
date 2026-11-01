/**
 * `pan start <id>` declaration (moved out of the CLI entry by PAN-4651, which
 * adds `--machine`, `--needs`, `--push-first` and `--ignore-unpushed`). Light:
 * the implementation loads only when the verb runs.
 */
import type { Command } from 'commander';

import { lazyAction } from '../lazy-action.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start <id>')
    .description('Create workspace and spawn agent for an issue')
    .option('--model <model>', 'Work model for this session (defaults to Cloister config)')
    .option('--harness <harness>', 'Coding-agent harness: claude-code | pi | codex | acp | kimi-code | opencode | muse | prime-agent (defaults to role/provider settings)')
    .option('--effort <level>', 'Claude Code effort: low | medium | high | xhigh | max (defaults to roles.work.effort)')
    .option('--tier <tier>', 'Remote workspace resiliency tier: ephemeral | durable (defaults to remote.resiliency_tier)')
    .option('--dry-run', 'Show what would be created')
    .option('--remote', 'Use remote workspace (Fly.io)')
    .option('--local', 'Use local workspace (explicit override)')
    .option('--plan <mode>', "Planning depth when no plan exists yet: interactive | auto | skip (default: config planning.default_mode, shipped default auto)")
    .option('--plan-model <model>', 'Planning model override when this start auto-plans (defaults to roles.plan.model); the work model stays --model')
    .option('--auto', '[deprecated: use --plan skip] Skip planning agent by synthesizing a minimal xBRIEF from the issue title/body')
    .option('--force', 'Clear paused, troubled, and pending-operator-decision gates and start anyway')
    .option('--fresh', 'Drop the saved Claude session (non-destructive) and start a new one — replaces a live session too, so it recovers an inert agent without a separate pan kill')
    .option('--host', 'Bypass workspace docker stack-health gate and spawn on the host')
    .option('--yes', 'Confirm --host in non-interactive contexts')
    .option('--skip-freshness', 'Bypass the plan-freshness preflight and spawn even if the plan names files deleted since it was written')
    .option('--machine <label|auto>', 'Start the issue agent on a linked machine (label or environment id), or auto to place it by load')
    .option('--needs <tags>', 'Comma-separated capability tags the machine must have (docker, gpu, ios-sim, …)')
    .option('--push-first', 'With --machine: push unpushed workspace commits before starting on the other machine')
    .option('--ignore-unpushed', 'With --machine: start even though local workspace commits are not pushed')
    .action(lazyAction(() => import('./start.js'), 'issueCommand'));
}
