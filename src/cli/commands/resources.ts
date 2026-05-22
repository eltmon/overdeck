import chalk from 'chalk';
import { execSync } from 'child_process';
import { readlinkSync } from 'fs';
import { listSessionsSync } from '../../lib/tmux.js';
import { listActiveConversations } from '../../lib/database/conversations-db.js';

interface ResourcesOptions {
  json?: boolean;
}

interface ClaudeProcess {
  pid: number;
  tty: string;
  memMb: number;
  model: string;
  started: string;
  sessionId: string | null;
  cwd: string;
  category: 'workspace' | 'conversation' | 'orphan';
  issueId: string | null;
  role: string | null;
  convId: string | null;
}

interface HeavyProcess {
  name: string;
  memMb: number;
  detail: string;
}

interface ModelBreakdown {
  model: string;
  count: number;
  totalMb: number;
}

interface ResourcesReport {
  system: { totalGb: number; usedGb: number; availGb: number; swapTotalGb: number; swapUsedGb: number };
  claude: { totalProcesses: number; totalMb: number };
  models: ModelBreakdown[];
  workspaceAgents: ClaudeProcess[];
  conversations: { count: number; totalMb: number; oldest: string | null; processes: ClaudeProcess[] };
  orphans: ClaudeProcess[];
  heavyProcesses: HeavyProcess[];
}

function parseMemInfo(): ResourcesReport['system'] {
  const output = execSync('free -b', { encoding: 'utf-8' });
  const lines = output.trim().split('\n');
  const memParts = lines[1].split(/\s+/);
  const swapParts = lines[2].split(/\s+/);
  const toGb = (b: string) => Math.round(parseInt(b) / 1073741824 * 10) / 10;
  return {
    totalGb: toGb(memParts[1]),
    usedGb: toGb(memParts[2]),
    availGb: toGb(memParts[6]),
    swapTotalGb: toGb(swapParts[1]),
    swapUsedGb: toGb(swapParts[2]),
  };
}

function getClaudeProcesses(): ClaudeProcess[] {
  // Use pgrep to find Claude PIDs first, then get structured info per-process.
  // This avoids buffer issues with `ps aux | grep` when agent command lines are huge
  // (specialist agents embed full prompts on the command line, 5-10 KB each).
  let pids: number[];
  try {
    const pgrepOut = execSync("pgrep -x claude", { encoding: 'utf-8' });
    pids = pgrepOut.trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }

  const processes: ClaudeProcess[] = [];
  for (const pid of pids) {
    let info: string;
    try {
      // Truncate command to 500 chars — we only need flags, not the full prompt
      info = execSync(
        `ps -o pid=,rss=,tty=,start=,args= -p ${pid} --no-headers | cut -c1-500`,
        { encoding: 'utf-8' }
      ).trim();
    } catch {
      continue;
    }

    const parts = info.split(/\s+/);
    const rssKb = parseInt(parts[1]);
    if (rssKb < 50 * 1024) continue;

    const tty = parts[2];
    // ps START shows "HH:MM:SS" for today or "MonDD" for earlier — normalize to HH:MM or MonDD
    const rawStart = parts[3];
    const started = /^\d{2}:\d{2}:\d{2}$/.test(rawStart) ? rawStart.slice(0, 5) : rawStart;
    const cmdParts = parts.slice(4);
    const cmd = cmdParts.join(' ');

    if (!/^claude\s|\/claude\s/.test(cmd)) continue;

    const modelMatch = cmd.match(/--model\s+(\S+)/);
    const sessionMatch = cmd.match(/--(?:session-id|resume)\s+(\S+)/);
    const model = modelMatch?.[1] ?? 'unknown';

    let cwd = '';
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      cwd = '?';
    }

    processes.push({
      pid,
      tty,
      memMb: Math.round(rssKb / 1024),
      model,
      started,
      sessionId: sessionMatch?.[1] ?? null,
      cwd,
      category: 'orphan',
      issueId: null,
      role: null,
      convId: null,
    });
  }

  return processes;
}

function getParentCmd(pid: number): string {
  try {
    const ppid = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf-8' }).trim();
    return execSync(`ps -o args= -p ${ppid}`, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function detectRole(parentCmd: string, cwd: string): string {
  if (parentCmd.includes('planning') || /\/\.(planning|pan)(\/|$)/.test(cwd)) return 'planning';
  if (parentCmd.includes('synthesis')) return 'review-synthesis';
  if (parentCmd.includes('review')) {
    const reviewType = parentCmd.match(/review-[^/]*\/([\w-]+)-claude/)?.[1];
    return reviewType ? `review-${reviewType}` : 'review';
  }
  if (parentCmd.includes('test-agent')) return 'test';
  if (parentCmd.includes('merge-agent')) return 'merge';
  return 'work';
}

function categorizeProcesses(processes: ClaudeProcess[]): void {
  const tmuxSessions = listSessionsSync();
  const conversations = listActiveConversations();
  const convTmuxNames = new Set(conversations.map(c => c.tmuxSession));

  for (const proc of processes) {
    const parentCmd = getParentCmd(proc.pid);

    // Workspace agent: cwd contains /workspaces/feature-
    const wsMatch = proc.cwd.match(/\/workspaces\/feature-([^/]+)/);
    if (wsMatch) {
      proc.category = 'workspace';
      proc.issueId = wsMatch[1];
      proc.role = detectRole(parentCmd, proc.cwd);
      continue;
    }

    // Specialist agent: parent is a specialist run-claude.sh (test/review/merge agents may run from project root)
    // Format: specialist-{project}-{ISSUE-ID}-{role}/run-claude.sh
    // Project names can contain hyphens (e.g. "panopticon-cli"), so match issue ID pattern greedily
    const specialistMatch = parentCmd.match(/agents\/specialist-.*?-([A-Z]+-\d+)-([^/]+)\//);
    if (specialistMatch) {
      proc.category = 'workspace';
      proc.issueId = specialistMatch[1].toLowerCase();
      proc.role = detectRole(parentCmd, proc.cwd);
      continue;
    }

    // Conversation: parent is a conversation launcher
    const convMatch = parentCmd.match(/conversations\/(conv-[^/]+)/);
    if (convMatch) {
      proc.category = 'conversation';
      proc.convId = convMatch[1];
      continue;
    }

    // Fallback: check if the TTY matches a conversation tmux session
    if (proc.tty !== '?' && proc.tty.startsWith('pts/')) {
      const ttyNum = proc.tty.replace('pts/', '');
      for (const session of tmuxSessions) {
        if (convTmuxNames.has(session.name)) {
          try {
            const paneInfo = execSync(
              `tmux -L panopticon list-panes -t ${session.name} -F '#{pane_tty}' 2>/dev/null`,
              { encoding: 'utf-8' }
            ).trim();
            if (paneInfo.includes(`/dev/pts/${ttyNum}`)) {
              proc.category = 'conversation';
              proc.convId = session.name;
              break;
            }
          } catch { /* ignore */ }
        }
      }
    }
  }
}

function getHeavyProcesses(claudePids: Set<number>): HeavyProcess[] {
  let output: string;
  try {
    output = execSync("ps aux --sort=-%mem", { encoding: 'utf-8' });
  } catch {
    return [];
  }

  const heavy: HeavyProcess[] = [];
  const seen = new Set<string>();

  for (const line of output.trim().split('\n').slice(1)) {
    const parts = line.split(/\s+/);
    const pid = parseInt(parts[1]);
    const memKb = parseInt(parts[5]);
    const memMb = Math.round(memKb / 1024);
    if (memMb < 100) break;
    if (claudePids.has(pid)) continue;

    const cmd = parts.slice(10).join(' ');
    if (cmd.includes('grep')) continue;

    let name: string;
    let detail: string;

    if (cmd.includes('vite')) {
      name = 'Vite dev server';
      detail = cmd.includes('host') ? 'with --host' : '';
    } else if (cmd.includes('java')) {
      name = 'Java (Spring Boot)';
      detail = '';
    } else if (cmd.includes('chrome') && cmd.includes('renderer')) {
      name = 'Chrome renderer';
      detail = '';
    } else if (cmd.includes('chrome') && cmd.includes('gpu')) {
      name = 'Chrome GPU';
      detail = '';
    } else if (cmd.includes('chrome')) {
      name = 'Chrome';
      detail = '';
    } else if (cmd.includes('tts_daemon')) {
      name = 'TTS daemon';
      detail = 'stream-voices';
    } else if (cmd.includes('playwright-mcp')) {
      name = 'Playwright MCP';
      detail = '';
    } else if (cmd.includes('chrome-devtools-mcp')) {
      name = 'Chrome DevTools MCP';
      detail = '';
    } else if (cmd.includes('gnome-shell')) {
      name = 'GNOME Shell';
      detail = '';
    } else if (cmd.includes('cursor')) {
      name = 'Cursor IDE';
      detail = '';
    } else if (cmd.includes('node') && cmd.includes('server.js')) {
      name = 'Panopticon dashboard';
      detail = '';
    } else if (cmd.includes('node')) {
      name = 'Node.js';
      detail = cmd.slice(0, 60);
    } else if (cmd.includes('python')) {
      name = 'Python';
      detail = cmd.slice(0, 60);
    } else {
      continue;
    }

    // Group Chrome renderers
    if (name === 'Chrome renderer') {
      const key = 'Chrome renderers';
      if (seen.has(key)) {
        const existing = heavy.find(h => h.name === key);
        if (existing) {
          existing.memMb += memMb;
          existing.detail = `${parseInt(existing.detail) + 1} tabs`;
        }
        continue;
      }
      seen.add(key);
      heavy.push({ name: key, memMb, detail: '1 tabs' });
      continue;
    }

    const key = `${name}-${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    heavy.push({ name, memMb, detail });
  }

  return heavy.sort((a, b) => b.memMb - a.memMb).slice(0, 15);
}

// ps START shows "HH:MM" for today's processes and "MonDD" for older ones.
const isDateFormat = (s: string) => /^[A-Z][a-z]{2}\d{2}$/.test(s);

function buildReport(): ResourcesReport {
  const system = parseMemInfo();
  const processes = getClaudeProcesses();
  categorizeProcesses(processes);

  const claudePids = new Set(processes.map(p => p.pid));
  const totalMb = processes.reduce((sum, p) => sum + p.memMb, 0);

  // Model breakdown
  const modelMap = new Map<string, { count: number; totalMb: number }>();
  for (const proc of processes) {
    const entry = modelMap.get(proc.model) ?? { count: 0, totalMb: 0 };
    entry.count++;
    entry.totalMb += proc.memMb;
    modelMap.set(proc.model, entry);
  }
  const models: ModelBreakdown[] = [...modelMap.entries()]
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.totalMb - a.totalMb);

  const workspaceAgents = processes
    .filter(p => p.category === 'workspace')
    .sort((a, b) => b.memMb - a.memMb);

  const convProcesses = processes.filter(p => p.category === 'conversation');
  const convTotalMb = convProcesses.reduce((sum, p) => sum + p.memMb, 0);
  const oldestConv = convProcesses.length > 0
    ? convProcesses.reduce((oldest, p) => {
        const pIsDate = isDateFormat(p.started);
        const oIsDate = isDateFormat(oldest.started);
        if (pIsDate && !oIsDate) return p;
        if (!pIsDate && oIsDate) return oldest;
        return p.started < oldest.started ? p : oldest;
      }).started
    : null;

  const orphans = processes.filter(p => p.category === 'orphan');

  return {
    system,
    claude: { totalProcesses: processes.length, totalMb },
    models,
    workspaceAgents,
    conversations: { count: convProcesses.length, totalMb: convTotalMb, oldest: oldestConv, processes: convProcesses },
    orphans,
    heavyProcesses: getHeavyProcesses(claudePids),
  };
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function formatGb(gb: number): string {
  return `${gb.toFixed(1)} GB`;
}

function printReport(report: ResourcesReport): void {
  const { system } = report;
  const memPct = Math.round((system.usedGb / system.totalGb) * 100);
  const swapPct = system.swapTotalGb > 0 ? Math.round((system.swapUsedGb / system.swapTotalGb) * 100) : 0;

  const memColor = memPct > 90 ? chalk.red : memPct > 75 ? chalk.yellow : chalk.green;
  const swapColor = swapPct > 80 ? chalk.red : swapPct > 50 ? chalk.yellow : chalk.green;

  console.log(chalk.bold('\n System Resources\n'));
  console.log(`  RAM:  ${memColor(`${formatGb(system.usedGb)} / ${formatGb(system.totalGb)}`)} (${memColor(`${memPct}%`)})`);
  if (system.swapTotalGb > 0) {
    console.log(`  Swap: ${swapColor(`${formatGb(system.swapUsedGb)} / ${formatGb(system.swapTotalGb)}`)} (${swapColor(`${swapPct}%`)})`);
  }
  console.log(`  Claude processes: ${chalk.cyan(String(report.claude.totalProcesses))} using ${chalk.cyan(formatMb(report.claude.totalMb))}`);

  // Model breakdown
  if (report.models.length > 0) {
    console.log(chalk.bold('\n Model Breakdown\n'));
    console.log(chalk.dim('  Model                  Count   RAM'));
    console.log(chalk.dim('  ' + '─'.repeat(48)));
    for (const m of report.models) {
      const modelName = m.model.padEnd(22);
      const count = String(m.count).padStart(3);
      console.log(`  ${modelName}  ${count}   ${formatMb(m.totalMb).padStart(8)}`);
    }
  }

  // Workspace agents
  if (report.workspaceAgents.length > 0) {
    console.log(chalk.bold('\n Workspace Agents\n'));
    console.log(chalk.dim('  Issue          Role              Model                RAM     Started'));
    console.log(chalk.dim('  ' + '─'.repeat(75)));
    for (const a of report.workspaceAgents) {
      const issue = (a.issueId ?? '?').padEnd(14);
      const role = (a.role ?? '?').padEnd(16);
      const model = a.model.padEnd(20);
      const mem = formatMb(a.memMb).padStart(7);
      console.log(`  ${issue}  ${role}  ${model} ${mem}   ${a.started}`);
    }
  }

  // Conversations
  if (report.conversations.count > 0) {
    console.log(chalk.bold('\n Conversations\n'));
    console.log(`  ${chalk.cyan(String(report.conversations.count))} active conversations using ${chalk.cyan(formatMb(report.conversations.totalMb))}`);
    if (report.conversations.oldest) {
      console.log(`  Oldest started: ${chalk.yellow(report.conversations.oldest)}`);
    }

    // Archival recommendation
    // Processes started on a previous day show "MonDD" format; today's show "HH:MM"
    const oldConvs = report.conversations.processes.filter(p => isDateFormat(p.started));
    if (oldConvs.length > 0) {
      const oldMb = oldConvs.reduce((sum, p) => sum + p.memMb, 0);
      console.log(chalk.yellow(`  ${oldConvs.length} conversation(s) older than today — archiving frees ~${formatMb(oldMb)}`));
    }
  }

  // Orphans (the real bug signal)
  if (report.orphans.length > 0) {
    console.log(chalk.bold.red('\n ⚠ Orphaned Processes\n'));
    console.log(chalk.red('  These Claude processes are NOT tracked by Panopticon:'));
    console.log(chalk.dim('  PID        Model                RAM     TTY       CWD'));
    console.log(chalk.dim('  ' + '─'.repeat(70)));
    for (const o of report.orphans) {
      const pid = String(o.pid).padEnd(8);
      const model = o.model.padEnd(20);
      const mem = formatMb(o.memMb).padStart(7);
      const tty = o.tty.padEnd(8);
      console.log(chalk.red(`  ${pid} ${model} ${mem}   ${tty}  ${o.cwd}`));
    }
  }

  // Other heavy processes
  if (report.heavyProcesses.length > 0) {
    console.log(chalk.bold('\n Other Processes (>100 MB)\n'));
    console.log(chalk.dim('  Process                  RAM       Detail'));
    console.log(chalk.dim('  ' + '─'.repeat(55)));
    for (const p of report.heavyProcesses) {
      const name = p.name.padEnd(24);
      const mem = formatMb(p.memMb).padStart(8);
      const detail = p.detail ? chalk.dim(p.detail) : '';
      console.log(`  ${name} ${mem}   ${detail}`);
    }
  }

  console.log();
}

export function resourcesCommand(options: ResourcesOptions): void {
  const report = buildReport();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}
