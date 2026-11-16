import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Code2, FileCode, GitCommit, Globe, ListPlus, MessageSquarePlus, Terminal } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { currentPlatform, formatSpec } from '../../../lib/shortcuts/keys'
import { EDITOR_LABELS, openFolderInEditor, useAvailableEditors } from '../../PanOpenInPicker'
import { useOpenMainCheckout } from '../../workspace/openMainWorkspace'
import { openNewConversationDialog } from '../../newConversation/newConversationDialogStore'
import { MenuItemButton, MenuOverlay, MenuSeparator, PopoverSurface } from '../../shared/ContextMenu'
import { AgentIcon } from './AgentIcon'

export interface HomeActionsProps {
  /** The registered project key; project-only actions render only with it. */
  projectKey?: string
  /**
   * The project the New conversation dialog preselects: the deck's project
   * key, as the left column's NewConversationButton passes. Defaults to
   * `projectKey`.
   */
  newConversationProjectKey?: string
  /** The registered checkout path, for Open in <editor>. */
  projectPath?: string
  /** The project has an issue prefix, so Start an issue… can resolve ids. */
  hasIssuePrefix: boolean
  /** A conversation is being created; the agent items are disabled. */
  busy: boolean
  /** The last conversation-creation error, shown inline. */
  errorText?: string
  onNewConversation: () => void
  onSelectAgent: (id: string) => void
  onFiles?: () => void
  onChanges?: () => void
  onTerminal: () => void
  onWebPage: () => void
  onStartIssue?: () => void
  onNewWorkspace?: (projectKey: string) => void
}

const AGENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
] as const

// Layout and color are separate: cn() does not merge Tailwind classes, so a
// primary button must not also carry the neutral colors.
const ACT_LAYOUT = 'inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-60'
const ACT = `${ACT_LAYOUT} border-border bg-card text-foreground hover:bg-accent`
const ACT_PRIMARY = `${ACT_LAYOUT} border-primary bg-primary text-primary-foreground`
const KEYCAP = 'keycap ml-1 rounded-md px-1.5 font-mono text-xs text-muted-foreground'

function Keycap({ children }: { children: ReactNode }) {
  return <span className={KEYCAP} aria-hidden>{children}</span>
}

function openWorkspaceCreation(projectKey: string) {
  window.history.pushState({ tab: 'workspace-new' }, '', `/workspaces/new?project=${encodeURIComponent(projectKey)}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * PAN-5294 G-D4 — the project Home action row: New conversation (split
 * button with the agent menu), Files, Changes on main, Terminal, Open in
 * <editor>, Start an issue…, and More ▾ (Web page, Main checkout, New
 * workspace). It never registers the `N` shortcut: the left column's
 * NewConversationButton owns `deck.new-conversation`.
 */
export function HomeActions({
  projectKey,
  newConversationProjectKey = projectKey,
  projectPath,
  hasIssuePrefix,
  busy,
  errorText,
  onNewConversation,
  onSelectAgent,
  onFiles,
  onChanges,
  onTerminal,
  onWebPage,
  onStartIssue,
  onNewWorkspace,
}: HomeActionsProps) {
  const [menu, setMenu] = useState<'agents' | 'more' | null>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const { editors, preferred } = useAvailableEditors()
  const mainCheckout = useOpenMainCheckout()
  const platform = currentPlatform()
  const editor = preferred && editors.includes(preferred) ? preferred : null
  const close = () => setMenu(null)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Project actions">
        <div className="relative inline-flex">
          <button
            type="button"
            onClick={onNewConversation}
            className={cn(ACT_PRIMARY, 'rounded-r-none')}
          >
            <MessageSquarePlus size={14} aria-hidden />
            New conversation
            <span className="keycap ml-1 rounded-md px-1.5 font-mono text-xs" aria-hidden>N</span>
          </button>
          <button
            ref={caretRef}
            type="button"
            aria-label="New conversation options"
            aria-haspopup="menu"
            aria-expanded={menu === 'agents'}
            onClick={() => setMenu(menu === 'agents' ? null : 'agents')}
            className={cn(ACT_PRIMARY, 'rounded-l-none border-l-0 px-2')}
          >
            <ChevronDown size={14} aria-hidden />
          </button>
          {menu === 'agents' && (
            <>
              <MenuOverlay onClick={close} />
              <PopoverSurface
                role="menu"
                aria-label="New conversation options"
                onClose={close}
                returnFocusRef={caretRef}
                className="absolute left-0 top-full z-[1000] mt-1 w-[260px]"
              >
                {AGENTS.map((agent) => (
                  <MenuItemButton
                    key={agent.id}
                    disabled={busy}
                    onClick={() => {
                      close()
                      onSelectAgent(agent.id)
                    }}
                  >
                    <AgentIcon id={agent.id} label={agent.label} size={14} />
                    {agent.label}
                  </MenuItemButton>
                ))}
                <MenuSeparator />
                <MenuItemButton
                  onClick={() => {
                    close()
                    openNewConversationDialog({ projectKey: newConversationProjectKey })
                  }}
                >
                  New conversation with options…
                </MenuItemButton>
              </PopoverSurface>
            </>
          )}
        </div>

        {projectKey && onFiles && (
          <button type="button" className={ACT} onClick={onFiles}>
            <FileCode size={14} aria-hidden />
            Files
            <Keycap>{formatSpec(platform === 'mac' ? 'Meta+Shift+E' : 'Ctrl+Shift+E', platform)}</Keycap>
          </button>
        )}

        {projectKey && onChanges && (
          <button type="button" className={ACT} onClick={onChanges}>
            <GitCommit size={14} aria-hidden />
            Changes on main
          </button>
        )}

        <button type="button" className={ACT} onClick={onTerminal}>
          <Terminal size={14} aria-hidden />
          Terminal
          {platform === 'mac' && <Keycap>⌘T</Keycap>}
        </button>

        {editor && projectPath && (
          <button type="button" className={ACT} onClick={() => void openFolderInEditor(projectPath, editor)}>
            <Code2 size={14} aria-hidden />
            {`Open in ${EDITOR_LABELS[editor]}`}
          </button>
        )}

        {hasIssuePrefix && onStartIssue && (
          <button type="button" className={ACT} onClick={onStartIssue}>
            <ListPlus size={14} aria-hidden />
            Start an issue…
          </button>
        )}

        <div className="relative inline-flex">
          <button
            ref={moreRef}
            type="button"
            className={ACT}
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            More
            <ChevronDown size={14} aria-hidden />
          </button>
          {menu === 'more' && (
            <>
              <MenuOverlay onClick={close} />
              <PopoverSurface
                role="menu"
                aria-label="More actions"
                onClose={close}
                returnFocusRef={moreRef}
                className="absolute left-0 top-full z-[1000] mt-1 w-[220px]"
              >
                <MenuItemButton
                  onClick={() => {
                    close()
                    onWebPage()
                  }}
                >
                  <Globe size={14} aria-hidden />
                  Web page
                </MenuItemButton>
                {projectKey && (
                  <MenuItemButton
                    disabled={mainCheckout.opening}
                    onClick={() => {
                      close()
                      void mainCheckout.open(projectKey)
                    }}
                  >
                    Main checkout
                  </MenuItemButton>
                )}
                {projectKey && (
                  <MenuItemButton
                    onClick={() => {
                      close()
                      if (onNewWorkspace) onNewWorkspace(projectKey)
                      else openWorkspaceCreation(projectKey)
                    }}
                  >
                    New workspace
                  </MenuItemButton>
                )}
              </PopoverSurface>
            </>
          )}
        </div>
      </div>
      {errorText && <p role="alert" className="text-[12px] text-destructive">{errorText}</p>}
    </div>
  )
}
