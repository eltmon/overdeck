import { Bot } from 'lucide-react'
import { ProviderIcon } from '../../chat/ProviderIcons'
import styles from '../stage.module.css'

export interface AgentIconProps {
  /** Agent/harness id, e.g. 'claude-code', 'codex'. */
  id: string
  /** Display label, used only for the provider letter-badge fallback. */
  label?: string
  size?: number
}

/** Map a harness/agent id to a model-picker provider key. */
function providerForAgent(id: string): string | null {
  const key = id.toLowerCase()
  if (key.includes('claude') || key.includes('anthropic')) return 'anthropic'
  if (key.includes('codex') || key.includes('openai') || key.includes('gpt')) return 'openai'
  return null
}

/**
 * AgentIcon — brand mark for an agent pill (PAN-1561). Reuses the model/harness
 * selector's `ProviderIcon`, so Claude Code / Codex render with the same
 * full-color official logos (Anthropic, OpenAI) used everywhere else. Falls back
 * to the generic lucide Bot glyph for agents without a provider mapping.
 */
export function AgentIcon({ id, label, size = 14 }: AgentIconProps) {
  const provider = providerForAgent(id)
  if (!provider) return <Bot size={size} />
  return (
    <span className={styles.agentLogo} style={{ width: size, height: size }}>
      <ProviderIcon provider={provider} label={label ?? id} className={styles.agentLogoSvg} />
    </span>
  )
}
