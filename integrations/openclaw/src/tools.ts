/** The two native chat tools, overdeck_pending and overdeck_answer (PAN-4954 WI-7, FR-4, FR-6,
 * FR-7, D-5, D-6; PAN-4927 W-INT2). Both always register; a missing setup becomes their answer.
 * overdeck_answer re-reads allowAnswers on every call and re-lists before answering, so it
 * refuses when the item at that number no longer has the ref the user saw. */
import { planAnswer } from './answer.js';
import type { OverdeckPluginConfig } from './config.js';
import type { McpCallResult, McpClient } from './mcp-client.js';
import type { PluginTool, ToolResult } from './openclaw-api.js';
import { formatPendingList, oneLine, parsePendingInput } from './pending.js';
import { ANSWER_PARAMETERS, PENDING_PARAMETERS } from './schema.js';

export const TOOL_NAMES = ['overdeck_pending', 'overdeck_answer'] as const;

export interface ToolDeps { getConfig(): OverdeckPluginConfig; client: McpClient | null; setupError: string | null }

const ANSWERS_OFF = 'Answering Overdeck prompts from OpenClaw is off. The operator can turn it on with plugins.entries.overdeck.config.allowAnswers: true.';
const NO_READ_ACCESS = 'The Overdeck connection lacks read:conversations access. Re-pair the connector (or create the token) with that access.';
const NO_APPROVE_ACCESS = 'The Overdeck connection lacks approve access. Re-pair the connector (or create the token) with "can answer questions and permission prompts" ticked.';

/** A tool answer the model sees as text instead of a thrown error. */
class ToolRefusal extends Error {}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

async function call(client: McpClient, name: string, args: Record<string, unknown>): Promise<string> {
  const result: McpCallResult = await client.callTool(name, args);
  if (!result.isError) return result.text;
  if (result.text.startsWith('Unknown tool list_pending_input')) throw new ToolRefusal(NO_READ_ACCESS);
  if (result.text.startsWith('Unknown tool answer_')) throw new ToolRefusal(NO_APPROVE_ACCESS);
  throw new ToolRefusal(`Overdeck refused: ${oneLine(result.text, 300)}`);
}

async function run(body: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await body());
  } catch (error) {
    if (error instanceof ToolRefusal) return text(error.message);
    return text(`Overdeck error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validationError(item: unknown, ref: unknown, choice: unknown): string | null {
  if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) return 'item must be a whole number of 1 or more, from overdeck_pending.';
  if (typeof ref !== 'string' || !/^[0-9a-f]{8}$/.test(ref)) return 'ref must be the 8-character ref shown with that item in overdeck_pending.';
  if (typeof choice !== 'string') return 'choice must be text.';
  return null;
}

export function createTools(deps: ToolDeps): PluginTool[] {
  const notSetUp = () => `Overdeck is not set up: ${deps.setupError}`;

  const pending: PluginTool = {
    name: 'overdeck_pending',
    description: 'List what in Overdeck is waiting for the user: questions, permission prompts, plan approvals and menus, numbered, with the choices each one takes.',
    parameters: PENDING_PARAMETERS,
    execute: (_toolCallId, _params) => run(async () => {
      if (!deps.client) return notSetUp();
      return formatPendingList(parsePendingInput(await call(deps.client, 'list_pending_input', {})));
    }),
  };

  const answer: PluginTool = {
    name: 'overdeck_answer',
    description: 'Answer one Overdeck prompt from overdeck_pending with the choice the user gave. Only call this when the user asked for that exact answer.',
    parameters: ANSWER_PARAMETERS,
    execute: (_toolCallId, params) => run(async () => {
      if (!deps.getConfig().allowAnswers) return ANSWERS_OFF;
      const client = deps.client;
      if (!client) return notSetUp();
      const { item, ref, choice } = (params ?? {}) as Record<string, unknown>;
      const invalid = validationError(item, ref, choice);
      if (invalid) return invalid;
      const n = item as number;

      const items = parsePendingInput(await call(client, 'list_pending_input', {}));
      const target = items[n - 1];
      if (!target || target.ref !== ref) {
        return `The list changed: item ${n} is no longer the prompt with ref ${ref as string}. Call overdeck_pending again and check with the user.`;
      }
      const plan = planAnswer(target, choice as string);
      if (!plan.ok) return plan.error;
      await call(client, plan.tool, plan.arguments);
      return plan.done;
    }),
  };

  return [pending, answer];
}
