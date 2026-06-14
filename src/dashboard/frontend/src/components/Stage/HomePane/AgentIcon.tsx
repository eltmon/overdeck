import { Bot } from 'lucide-react'
import { HarnessLogo } from '../../shared/branding'
import styles from '../stage.module.css'
import type { Harness } from '../../Settings/types'

export interface AgentIconProps {
  /** Agent/harness id, e.g. 'claude-code', 'codex'. */
  id: string
  /** Display label, used only for the provider letter-badge fallback. */
  label?: string
  size?: number
}

function harnessForAgent(id: string): Harness | null {
  const key = id.toLowerCase()
  if (key === 'pi' || key.includes('pi-')) return 'pi'
  if (key.includes('claude') || key.includes('anthropic')) return 'claude-code'
  if (key.includes('codex') || key.includes('openai') || key.includes('gpt')) return 'codex'
  return null
}

/**
 * AgentIcon — brand mark for an agent pill (PAN-1561). Uses harness branding
 * for known harness ids and falls back to the generic lucide Bot glyph for
 * unknown agents.
 */
export function AgentIcon({ id, size = 14 }: AgentIconProps) {
  const harness = harnessForAgent(id)
  if (!harness) return <Bot data-testid="agent-icon-bot" size={size} />
  return (
    <span className={styles.agentLogo} style={{ width: size, height: size }}>
      <HarnessLogo harness={harness} className={styles.agentLogoSvg} />
    </span>
  )
}
