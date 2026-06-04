import { Plus } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import styles from '../stage.module.css'

export interface AgentPill {
  /** Agent/harness id (e.g. 'claude-code', 'codex'). */
  id: string
  label: string
}

/** Default agents, aligned with the launcher's DEFAULT_INTENTS agents. */
export const DEFAULT_AGENT_PILLS: AgentPill[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
]

export interface AgentDockProps {
  agents?: AgentPill[]
  /** Open/create an agent conversation + pane for this agent (mount-stage wires it). */
  onSelectAgent: (agentId: string) => void
  /** "+ More Agents" affordance. */
  onMore?: () => void
}

/**
 * AgentDock — the HomePane agent launcher row (PAN-1549). One pill per
 * available agent/harness plus a "+ More Agents" affordance. Clicking a pill
 * asks the consumer to open an agent pane backed by a conversation for that
 * agent in this workspace.
 */
export function AgentDock({ agents = DEFAULT_AGENT_PILLS, onSelectAgent, onMore }: AgentDockProps) {
  return (
    <div className={styles.dock} role="group" aria-label="Agents">
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          className={styles.pill}
          onClick={() => onSelectAgent(a.id)}
        >
          <AgentIcon id={a.id} label={a.label} size={14} />
          {a.label}
        </button>
      ))}
      <button
        type="button"
        className={`${styles.pill} ${styles.pillGhost}`}
        onClick={() => onMore?.()}
      >
        <Plus size={13} />
        More Agents
      </button>
    </div>
  )
}
