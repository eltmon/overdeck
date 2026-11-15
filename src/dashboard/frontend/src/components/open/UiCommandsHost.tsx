// Mounts the UI command listener once, inside DeckNavigationProvider (PAN-5349).
import { useDeckNavigation } from '../frame/deck/deckNavigation'
import { useUiCommands } from '../../lib/uiCommands/useUiCommands'

export function UiCommandsHost(): null {
  useUiCommands(useDeckNavigation())
  return null
}
