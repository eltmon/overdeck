import { deliverAgentMessage } from '../agents.js';
import { paneHasBlockingChoiceMenu } from '../pane-choice-menu.js';
import { capturePaneText } from '../tmux.js';

export type ResumeContractDeliveryResult = 'delivered' | 'skipped-user' | 'skipped-gated' | 'failed';

/** Native Kimi must receive managed context even when the operator opts out of resume prose. */
export async function deliverMandatoryKimiResumeContext(
  tmuxSession: string,
  workspace: string,
  method: Parameters<typeof deliverAgentMessage>[3],
): Promise<void> {
  const resumeGatePane = await capturePaneText(tmuxSession, 90).catch(() => '');
  if (resumeGatePane && paneHasBlockingChoiceMenu(resumeGatePane)) {
    throw new Error(`Managed Kimi resume blocked for ${tmuxSession}: the native resume choice gate must be answered before context delivery.`);
  }
  const delivery = await deliverAgentMessage(
    tmuxSession,
    '',
    'conversation-resume-context',
    method,
    { kimiContext: { workspace } },
  );
  if (!delivery.ok) {
    throw new Error(
      `Managed Kimi resume context delivery failed for ${tmuxSession}: `
      + (delivery.failure ?? `delivery returned ok=false via ${delivery.path}`),
    );
  }
}

/** A Kimi session is not healthy when requested resume text failed or became gated. */
export function assertKimiResumeContractResult(result: ResumeContractDeliveryResult): void {
  if (result === 'failed' || result === 'skipped-gated') {
    throw new Error(`Managed Kimi resume contract was not delivered (${result}).`);
  }
}

export async function deliverResumeContractUnlessGated(
  tmuxSession: string,
  contract: string,
  caller: string,
  method: Parameters<typeof deliverAgentMessage>[3],
  requested = true,
  options: Parameters<typeof deliverAgentMessage>[4] = {},
): Promise<ResumeContractDeliveryResult> {
  if (!requested) return 'skipped-user';

  const resumeGatePane = await capturePaneText(tmuxSession, 90).catch(() => '');
  if (resumeGatePane && paneHasBlockingChoiceMenu(resumeGatePane)) {
    console.log(`[conversations] resume contract skipped for ${tmuxSession} — the harness is showing a blocking choice menu; the operator answers it`);
    return 'skipped-gated';
  }

  try {
    const delivery = Object.keys(options).length > 0
      ? await deliverAgentMessage(tmuxSession, contract, caller, method, options)
      : await deliverAgentMessage(tmuxSession, contract, caller, method);
    if (!delivery.ok) return 'failed';
    return 'delivered';
  } catch (err: unknown) {
    console.error(`[conversations] resume contract delivery failed for ${tmuxSession}:`, err instanceof Error ? err.message : String(err));
    return 'failed';
  }
}
