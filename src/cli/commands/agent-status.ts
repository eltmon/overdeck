import chalk from 'chalk';
import { Effect } from 'effect';
import { listRunningAgents } from '../../lib/agents.js';
import { listSessions, capturePane } from '../../lib/tmux.js';

interface AgentStatusOptions {
  json?: boolean;
  lines?: number;
}

interface SessionInfo {
  name: string;
  model: string | null;
  status: 'running' | 'idle' | 'stuck' | 'done' | 'error';
  detail: string;
  age: string | null;
  cost: string | null;
}

const MODEL_PATTERNS = [
  /K\d+\.\d+-code-preview/,
  /claude-(?:opus|sonnet|haiku)-[\d-]+/,
  /(?:Opus|Sonnet|Haiku)\s+[\d.]+/,
  /gpt-[\d.]+(?:-\w+)?/,
  /minimax-m[\d.]+(?:-\w+)?/,
  /glm-[\d.]+/,
  /gemini-[\d.]+(?:-\w+)?/,
  /kimi-k[\d.]+/,
];

function extractModel(output: string): string | null {
  for (const pattern of MODEL_PATTERNS) {
    const match = output.match(pattern);
    if (match) return match[0];
  }
  const modelFlag = output.match(/--model\s+(\S+)/);
  if (modelFlag) return modelFlag[1];
  return null;
}

function extractCost(output: string): string | null {
  const match = output.match(/cost\s+\$[\d.]+/);
  return match ? match[0] : null;
}

function detectStatus(output: string): { status: SessionInfo['status']; detail: string } {
  const lines = output.trim().split('\n').filter(Boolean);
  const last20 = lines.slice(-20).join('\n');

  if (/Resume from summary|Don't ask me again|Resume full session/.test(last20)) {
    return { status: 'stuck', detail: 'Stuck at session resume prompt' };
  }
  if (/Interrupted.*What should Claude do instead/.test(last20)) {
    return { status: 'stuck', detail: 'Interrupted — waiting at prompt' };
  }
  if (/permission.*denied|PERMISSION_DENIED/i.test(last20)) {
    return { status: 'stuck', detail: 'Blocked on permission prompt' };
  }
  if (/error|Error|FATAL|panic/i.test(last20) && !/error handling|error message|errorCode/i.test(last20)) {
    const errorLine = lines.filter(l => /error|Error|FATAL/i.test(l)).pop();
    return { status: 'error', detail: errorLine?.trim().slice(0, 80) || 'Error detected' };
  }
  if (/Churning|Slithering|Thinking|Reasoning/i.test(last20)) {
    const match = last20.match(/(Churning|Slithering|Thinking|Reasoning)[^(]*\(([^)]+)\)/i);
    return { status: 'running', detail: match ? `${match[1]} (${match[2]})` : 'Generating...' };
  }
  if (/review.*auto-triggered|review & test pipeline|pan done/i.test(last20)) {
    return { status: 'done', detail: 'Work complete — review pipeline triggered' };
  }
  if (/completed in \d+ms/.test(last20)) {
    return { status: 'done', detail: 'Review complete' };
  }

  const promptLine = [...lines].reverse().find((l: string) => l.trim() === '>' || l.includes('❯'));
  if (promptLine) {
    return { status: 'idle', detail: 'At prompt — no active work' };
  }

  const lastNonEmpty = [...lines].reverse().find((l: string) => l.trim().length > 10);
  return { status: 'running', detail: lastNonEmpty?.trim().slice(0, 80) || 'Active' };
}

function analyzeSession(name: string, lines: number) {
  return Effect.gen(function* () {
    const output = yield* capturePane(name, lines);
    const model = extractModel(output);
    const cost = extractCost(output);
    const { status, detail } = detectStatus(output);
    return { name, model, status, detail, age: null, cost } satisfies SessionInfo;
  });
}

const STATUS_COLORS: Record<SessionInfo['status'], (s: string) => string> = {
  running: chalk.green,
  idle: chalk.yellow,
  stuck: chalk.red,
  done: chalk.cyan,
  error: chalk.red.bold,
};

export async function agentStatusCommand(options: AgentStatusOptions): Promise<void> {
  const lines = options.lines ?? 20;

  const { agentInfos, reviewInfos, planningInfos } = await Effect.runPromise(
    Effect.gen(function* () {
      const [allAgents, sessions] = yield* Effect.all([
        listRunningAgents(),
        listSessions(),
      ], { concurrency: 'unbounded' });

      const tmuxSessionNames = new Set(sessions.map(s => s.name));

      // Only show agents that have a live tmux session
      const agents = allAgents.filter(a => tmuxSessionNames.has(a.id));

      const agentSessionNames = new Set(agents.map(a => a.id));
      const reviewSessions = sessions.filter(s =>
        s.name.startsWith('review-') || s.name.startsWith('specialist-')
      );
      const planningSessions = sessions.filter(s =>
        s.name.startsWith('planning-') && !agentSessionNames.has(s.name)
      );

      // Analyze all sessions in parallel
      const agentInfos = yield* Effect.forEach(
        agents,
        (agent) => analyzeSession(agent.id, lines).pipe(
          Effect.map(info => ({
            ...info,
            model: info.model || agent.model,
            issueId: agent.issueId,
            role: agent.role,
          })),
        ),
        { concurrency: 'unbounded' },
      );

      const reviewInfos = yield* Effect.forEach(
        reviewSessions,
        s => analyzeSession(s.name, lines),
        { concurrency: 'unbounded' },
      );

      const planningInfos = yield* Effect.forEach(
        planningSessions,
        s => analyzeSession(s.name, lines),
        { concurrency: 'unbounded' },
      );

      return { agentInfos, reviewInfos, planningInfos };
    }),
  );

  if (options.json) {
    console.log(JSON.stringify({ agents: agentInfos, review: reviewInfos, planning: planningInfos }, null, 2));
    return;
  }

  // Work agents table
  if (agentInfos.length > 0) {
    console.log(chalk.bold('\nWork Agents\n'));
    for (const a of agentInfos) {
      const statusStr = STATUS_COLORS[a.status](a.status.toUpperCase());
      console.log(`  ${chalk.cyan(a.name)}  ${chalk.dim(a.issueId)}`);
      console.log(`    Model:  ${a.model ?? chalk.dim('unknown')}`);
      console.log(`    Role:   ${a.role ?? chalk.dim('--')}`);
      console.log(`    Status: ${statusStr}  ${chalk.dim(a.detail)}`);
      if (a.cost) console.log(`    Cost:   ${a.cost}`);
      console.log('');
    }
  } else {
    console.log(chalk.dim('\nNo work agents running.\n'));
  }

  // Review pipeline
  if (reviewInfos.length > 0) {
    console.log(chalk.bold('Review Pipeline\n'));

    const coordinators = reviewInfos.filter(r => r.name.includes('coordinator'));
    const reviewers = reviewInfos.filter(r => !r.name.includes('coordinator'));

    for (const c of coordinators) {
      const statusStr = STATUS_COLORS[c.status](c.status.toUpperCase());
      console.log(`  ${chalk.magenta(c.name)}`);
      console.log(`    Model:  ${c.model ?? chalk.dim('unknown')}`);
      console.log(`    Status: ${statusStr}  ${chalk.dim(c.detail)}`);
      console.log('');
    }

    if (reviewers.length > 0) {
      for (const r of reviewers) {
        const role = r.name.split('-').pop() || 'review';
        const statusStr = STATUS_COLORS[r.status](r.status.toUpperCase());
        console.log(`  ${chalk.blue(role.padEnd(14))} ${statusStr.padEnd(20)} ${r.model ?? chalk.dim('unknown')}`);
        if (r.detail) console.log(`  ${''.padEnd(14)} ${chalk.dim(r.detail)}`);
      }
      console.log('');
    }
  }

  // Planning sessions
  if (planningInfos.length > 0) {
    console.log(chalk.bold('Planning Sessions\n'));
    for (const p of planningInfos) {
      const statusStr = STATUS_COLORS[p.status](p.status.toUpperCase());
      console.log(`  ${chalk.yellow(p.name)}`);
      console.log(`    Status: ${statusStr}  ${chalk.dim(p.detail)}`);
      console.log('');
    }
  }

  // Problems summary
  const problems = [
    ...agentInfos.filter(a => a.status === 'stuck' || a.status === 'error'),
    ...reviewInfos.filter(r => r.status === 'stuck' || r.status === 'error'),
    ...planningInfos.filter(p => p.status === 'stuck' || p.status === 'error'),
  ];

  if (problems.length > 0) {
    console.log(chalk.red.bold('Problems\n'));
    for (const p of problems) {
      console.log(`  ${chalk.red('!')} ${p.name}: ${p.detail}`);
    }
    console.log('');
  }
}
