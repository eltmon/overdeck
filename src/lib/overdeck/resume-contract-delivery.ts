import { deliverAgentMessage } from '../agents.js';
import { paneHasBlockingChoiceMenu } from '../pane-choice-menu.js';
import { capturePaneText } from '../tmux.js';

export type ResumeContractDeliveryResult = 'delivered' | 'skipped-user' | 'skipped-gated' | 'failed';

export async function deliverResumeContractUnlessGated(
  tmuxSession: string,
  contract: string,
  caller: string,
  method: Parameters<typeof deliverAgentMessage>[3],
  requested = true,
): Promise<ResumeContractDeliveryResult> {
  if (!requested) return 'skipped-user';

  const resumeGatePane = await capturePaneText(tmuxSession, 90).catch(() => '');
  if (resumeGatePane && paneHasBlockingChoiceMenu(resumeGatePane)) {
    console.log(`[conversations] resume contract skipped for ${tmuxSession} — the harness is showing a blocking choice menu; the operator answers it`);
    return 'skipped-gated';
  }

  try {
    await deliverAgentMessage(tmuxSession, contract, caller, method);
    return 'delivered';
  } catch (err: unknown) {
    console.error(`[conversations] resume contract delivery failed for ${tmuxSession}:`, err instanceof Error ? err.message : String(err));
    return 'failed';
  }
}
