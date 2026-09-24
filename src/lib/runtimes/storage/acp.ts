/**
 * ACP transcript storage (PAN-3958 CH-7, D11): the only place that knows where an
 * ACP agent's transcript lives — `<agentsRoot>/<agentId>/acp-session.jsonl`. OpenCode
 * runs over ACP, so this is OpenCode's transcript too; Overdeck writes it
 * (`acp/transcript.ts` AcpTranscriptWriter) rather than reading OpenCode's own store.
 *
 * Leaf module: imports only `node:*` and `../../paths.js`, so any layer can import
 * it without creating a cycle. `npm run lint:harness-storage` keeps this path from
 * being rebuilt anywhere else.
 */
import { join } from "node:path";
import { getOverdeckHome } from "../../paths.js";

/** File name of the ACP transcript Overdeck writes in each agent directory. */
export const ACP_TRANSCRIPT_FILE = "acp-session.jsonl";

/** An ACP agent's transcript: `<agentsRoot>/<agentId>/acp-session.jsonl`. */
export function acpTranscriptPath(
  agentId: string,
  agentsRoot = join(getOverdeckHome(), "agents"),
): string {
  return join(agentsRoot, agentId, "acp-session.jsonl");
}
