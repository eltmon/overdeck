/** Mirrors ACCESS_TOKEN_SCOPES in src/lib/access-tokens.ts (parity-tested). */
export const ACCESS_TOKEN_SCOPE_OPTIONS = [
  { id: 'read:events', description: 'The live event stream and its version.' },
  { id: 'read:state', description: 'Issue, agent, Flywheel and pipeline reads.' },
  { id: 'read:conversations', description: 'Conversation lists, messages and summaries.' },
  { id: 'tell', description: 'Send a message to an agent or a conversation.' },
  { id: 'operate', description: 'Everything tell allows, plus terminal WebSockets.' },
  { id: 'admin', description: 'Everything, like a paired device.' },
] as const;
