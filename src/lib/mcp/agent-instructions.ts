/**
 * PAN-4927 W-INJ4 (PAN-4935): the tools block at the end of every managed
 * launch context. Agents with the `overdeck` MCP server get the MCP block;
 * every other agent gets the CLI block with the `pan` equivalents (D-13).
 * Leaf module: no imports, so context-layers can use it.
 */
export const OVERDECK_MCP_INSTRUCTIONS = [
  '## Overdeck tools',
  "You have an `overdeck` MCP server. Prefer its tools to running `pan` in a shell. A tool missing from your list is outside your role's scope.",
  '- Same-harness helper for a quick subtask: use your own subagent tool. A separate worker, another harness, another machine or background work: `delegate_task`.',
  '- Never poll. A wait tool returns within 50 s; when it answers `running` or `pending` with `next`, call `next` again. Do not use sleep, watch loops or repeated status calls.',
  '- Checklist: `task_claim` before an item, `task_done` after it. Finish with `done`.',
  '- A secret you need: call `request_secret`. Never ask for one in chat and never put one in a tool argument.',
  '- A machine the operator names that is not linked: call `link_machine` with their words as `hint`. Never ask for a pairing code.',
  '- A PR you opened or were given: `link_pull_request`, then `watch_pull_request` if you must react to checks or reviews.',
  "- Answering another conversation's prompt needs the `approve` scope; most agents lack it.",
].join('\n');

export const OVERDECK_CLI_INSTRUCTIONS = [
  '## Overdeck commands',
  'You have no `overdeck` MCP server. Run these `pan` commands in your shell.',
  '- Same-harness helper for a quick subtask: use your own subagent tool. A separate worker, another harness or background work: `pan worker run`, then `pan worker wait <worker-id>`. A worker records its result with `pan worker report <worker-id> --stdin`.',
  '- Never poll in a loop. `pan worker wait` and `pan lane wait` block until there is news.',
  '- Checklist: `pan task claim <issue> <item>` before an item, `pan task done <issue> <item>` after its `Item:` commit is pushed. Finish with `pan done <issue>`.',
  '- Hand a conversation off: `pan handoff self "<focus>"`.',
  '- A durable fact: `pan memory add <id> --type <type> --description "<line>"`. Look first with `pan memory search <query>`.',
  '- Gauntlet lanes: `pan lane start`, then `pan lane wait`.',
  '- A PR you opened or were given: `pan conversations link-pr <conversation> <url>`.',
  '- A secret or a machine link needs the operator. Ask them to link the machine in the Overdeck dashboard or to give you the secret outside this chat. Never ask for a secret value or a pairing code in chat.',
].join('\n');

/** The tool names the MCP block mentions; the test checks each is in ALL_TOOLS. */
export const INSTRUCTION_TOOL_NAMES: readonly string[] = [
  'delegate_task', 'task_claim', 'task_done', 'done', 'request_secret', 'link_machine', 'link_pull_request', 'watch_pull_request',
];

/** The tools block for a launch: the MCP block when it gets the `overdeck` server, else the CLI block. */
export function overdeckInstructionsBlock(overdeckMcp: boolean): string {
  return overdeckMcp ? OVERDECK_MCP_INSTRUCTIONS : OVERDECK_CLI_INSTRUCTIONS;
}
