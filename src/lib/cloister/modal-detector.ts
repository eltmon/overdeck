import { capturePane } from '../tmux.js';

export interface KnownModal {
  id: string;
  matches: (pane: string) => boolean;
  keys: readonly string[];
}

// Claude Code boot-blocking TUI screens: first-run onboarding (theme picker,
// login-method picker, OAuth paste prompt) and the folder-trust dialog. A
// session parked on one never starts its JSONL transcript, so the conversation
// chat view has nothing to render and its composer cannot answer the screen —
// only the terminal can. These must never be auto-answered: the login picker
// starts an OAuth flow, and completing a spurious onboarding can rewrite the
// real ~/.claude.json (conv-20260714-4261: a transient config read race at
// spawn made a fully-configured machine boot into fresh-install onboarding).
const CLAUDE_BOOT_SCREEN_PATTERNS: readonly RegExp[] = [
  /Choose the text style that looks best with your terminal/i,
  /Select login method:/i,
  /Do you trust the files in this (?:folder|directory)\?/i,
  /Paste code here if prompted/i,
];

export function paneShowsClaudeBootBlockingScreen(pane: string): boolean {
  return CLAUDE_BOOT_SCREEN_PATTERNS.some(pattern => pattern.test(pane));
}

/** Rollout JSONL is launch/turn attribution only until a captured switch proves otherwise. */

export interface ModalHandlerDeps {
  capturePane: (agentId: string) => Promise<string>;
  sendKey: (agentId: string, key: string) => Promise<void>;
  settle: () => Promise<void>;
}
