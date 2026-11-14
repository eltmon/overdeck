// The `?` keyboard-shortcuts sheet (PAN-5287 §6.7, FR-8): every registered
// shortcut with its label and the current platform's keys, grouped. It reads
// the live registrations, so rows come and go as components mount.

import { Modal } from '../../components/shared/Modal'
import { currentPlatform, formatSpec } from './keys'
import { useShortcutList, type ShortcutGroup } from './registry'

const GROUP_ORDER: readonly ShortcutGroup[] = ['General', 'Navigation', 'Tabs', 'Files', 'Safety']

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const shortcuts = useShortcutList()
  const platform = currentPlatform()
  const seen = new Set<string>()
  const rows = shortcuts.flatMap((def) => {
    const spec = def.keys[platform]
    if (!spec || def.hidden || seen.has(def.id)) return []
    seen.add(def.id)
    return [{ id: def.id, label: def.label, group: def.group, keys: formatSpec(spec, platform) }]
  })

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="shortcuts-sheet">
        {GROUP_ORDER.map((group) => {
          const groupRows = rows.filter((row) => row.group === group)
          if (groupRows.length === 0) return null
          return (
            <section key={group} aria-label={group}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{group}</h3>
              <ul className="flex flex-col">
                {groupRows.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-4 py-1 text-sm text-foreground">
                    <span>{row.label}</span>
                    <span className="rounded-sm border border-border bg-accent px-1 font-mono text-xs text-muted-foreground">
                      {row.keys}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
