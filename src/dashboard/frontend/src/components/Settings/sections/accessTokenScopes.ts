/** Mirrors ACCESS_TOKEN_SCOPES in src/lib/access-tokens.ts (parity-tested). */
export const ACCESS_TOKEN_SCOPE_OPTIONS = [
  { id: 'read:events', description: 'The live event stream and its version.' },
  { id: 'read:state', description: 'Issue, agent, Flywheel and pipeline reads.' },
  { id: 'read:conversations', description: 'Conversation lists, messages and summaries.' },
  { id: 'read:costs', description: 'Cost summaries and token spend.' },
  { id: 'read:settings', description: 'Read settings and configuration.' },
  { id: 'tell', description: 'Send a message to an agent or a conversation.' },
  { id: 'operate', description: 'Everything tell allows, plus terminal WebSockets.' },
  { id: 'approve', description: 'Answer blocking prompts: permissions, menus, questions and plan approvals.' },
  { id: 'forward', description: 'Forward requests on behalf of an operator (linked machines).' },
  { id: 'admin', description: 'Everything, like a paired device.' },
] as const;
