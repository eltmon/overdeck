/**
 * PAN-5294 G-D9 — the Start request sequence behind Home's Start an issue
 * dialog, kept out of the view. It mirrors IssueComposer's spawn handling
 * (guardrail acknowledgement, Codex re-auth, start-block recovery) but returns
 * a tagged result so the dialog can show the guardrail warnings itself
 * instead of a window.confirm.
 */
import type { StartAgentResponse } from '../../../types'
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../../lib/pending-codex-spawn'
import { openRecoveryForStartBlock } from '../../../lib/resumeRecovery'

export type StartIssueResult =
  | { kind: 'started' }
  | { kind: 'needs-ack'; warnings: string[] }
  | { kind: 'codex-blocked'; message: string }
  | { kind: 'recovery' }
  | { kind: 'error'; message: string }

export async function startIssueAgent(
  issueId: string,
  { acknowledged }: { acknowledged: boolean },
): Promise<StartIssueResult> {
  const body: Record<string, unknown> = acknowledged ? { issueId, guardrailAcknowledged: true } : { issueId }
  let res: Response
  try {
    res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  const data = await res.json().catch(() => ({})) as StartAgentResponse

  if (res.status === 409 && data.requiresAcknowledgement && !acknowledged) {
    return { kind: 'needs-ack', warnings: (data.guardrails?.warnings ?? []).map((warning) => warning.message) }
  }
  if (res.ok) return { kind: 'started' }
  if (isCodexBlockedResponse(res, data)) {
    setPendingCodexSpawn(body)
    return { kind: 'codex-blocked', message: data.hint || data.error || 'Codex authentication expired — re-authenticate to continue' }
  }
  // Start-block 409s open the recovery dialog; the dialog closes and it takes over.
  if (openRecoveryForStartBlock(res.status, data, issueId)) return { kind: 'recovery' }
  return { kind: 'error', message: data.error || data.hint || `Failed to start ${issueId}` }
}
