// Conversation changes (PAN-5284 §6.1, child S). Types only; child A serves them
// from GET /api/conversations/:name/changes and GET /api/projects/:key/changes.

export type ChangeScope = "conversation" | "turn" | "uncommitted" | "main"

export interface ChangedFile {
  path: string
  status: "A" | "M" | "D" | "R"
  additions: number
  deletions: number
  oldPath?: string
}

export interface UncommittedFile extends ChangedFile {
  /** 'lines' when edit records attribute specific lines; 'file' when only the file is known. */
  attribution: "lines" | "file"
  /** Assistant message ids of the turns that edited this file (lets one response feed every turn card). */
  turnIds: string[]
  /** Lines in the working-tree diff of this file that this conversation did NOT write (only when attribution === 'lines'). */
  otherLines?: number
  /** Other conversations whose edit records match the other lines (Claude Code only; may be empty). */
  otherConversations?: { name: string; title: string }[]
}

export interface ChangeCommit {
  sha: string
  shortSha: string
  subject: string
  authoredAt: string
  pushed: boolean
  /** How the commit was tied to the conversation. */
  attribution: "trailer" | "tool-output"
  files: ChangedFile[]
  /** Assistant message id of the turn that made it, when known. */
  turnId?: string
  /** Set in scope 'main': who made the commit. */
  by?: {
    kind: "conversation" | "agent" | "unattributed"
    id?: string
    title?: string
    isThisConversation?: boolean
  }
}

/** Added to each row of GET /api/conversations for conversations whose transcript changed in the last 24 h (from the changes cache; absent otherwise). */
export interface ConversationChangeTotals {
  files: number
  additions: number
  deletions: number
  uncommittedFiles: number
  commitsLocal: number
}

export interface ConversationChanges {
  conversation: string
  repoRoot: string
  rootId: string | null
  branch: string | null
  scope: ChangeScope
  turnId?: string
  uncommitted: UncommittedFile[]
  commits: ChangeCommit[]
  totals: {
    files: number
    additions: number
    deletions: number
    commitsPushed: number
    commitsLocal: number
    uncommittedFiles: number
  }
}

export interface ProjectCommit {
  sha: string
  shortSha: string
  subject: string
  authoredAt: string
  by: { kind: "conversation" | "agent" | "unattributed"; id?: string; title?: string }
}

export interface ProjectChanges {
  projectKey: string
  branch: string
  commits: ProjectCommit[]
}
