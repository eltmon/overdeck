import chalk from 'chalk';

export interface PlanningStreamEvent {
  type?: string;
  label?: string;
  detail?: string;
  status?: string;
  sessionName?: string;
  error?: string;
}

export interface StreamPlanningSessionOptions {
  issueId: string;
  /** Updates the spinner text on progress events. */
  setSpinnerText: (text: string) => void;
  /** Called with the final sessionName when the stream completes. */
  onComplete?: (sessionName: string) => void;
}

/**
 * Read a server-sent-event stream from a start-planning response body and
 * update the spinner as events arrive. Shared by pan plan and pan start so
 * the two commands cannot drift.
 */
export async function streamPlanningSession(
  response: Response,
  options: StreamPlanningSessionOptions,
): Promise<void> {
  const { issueId, setSpinnerText, onComplete } = options;
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
  let sessionName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6)) as PlanningStreamEvent;
      if (event.type === 'started') {
        sessionName = event.sessionName || sessionName;
      } else if (event.type === 'progress') {
        setSpinnerText(`${event.label ?? 'Planning'}${event.detail ? ` — ${event.detail}` : ''}`);
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Planning setup failed');
      } else if (event.type === 'complete') {
        sessionName = event.sessionName || sessionName;
      }
    }
  }

  if (onComplete) {
    onComplete(sessionName);
  }
}

/**
 * Build the JSON body for the /api/issues/:id/start-planning endpoint.
 * Shared by pan plan and pan start so the request shape cannot drift.
 */
export function buildStartPlanningBody(input: {
  auto: boolean;
  autoStart: boolean;
  probe?: boolean;
  model?: string;
  workModel?: string;
  harness?: string;
  effort?: string;
  workspaceLocation?: 'remote' | 'local';
  startedBy?: string;
}): string {
  return JSON.stringify({
    auto: input.auto,
    autoStart: input.autoStart,
    probe: input.probe === true,
    model: input.model || undefined,
    workModel: input.workModel || undefined,
    harness: input.harness || undefined,
    effort: input.effort || undefined,
    workspaceLocation: input.workspaceLocation ?? 'local',
    startedBy: input.startedBy || undefined,
  });
}

/**
 * Print the dashboard-down error for the start-planning route.
 */
export function printPlanningConnectionError(issueId: string): void {
  console.error(chalk.red(`Planning failed for ${issueId}: dashboard is not responding.`));
  console.error(chalk.dim('Make sure the dashboard is running: pan up'));
  console.error(chalk.dim(`Or start offline with: pan start ${issueId} --plan skip`));
}
