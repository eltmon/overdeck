/**
 * Command-palette action for Computer Use (PAN-5461 WI-7a): "Open Computer Use
 * settings" navigates to Settings → Computer Use. Rows are structurally typed
 * like palette-anywhere-actions.ts to avoid importing CommandPalette.
 */
import { MousePointerClick } from 'lucide-react';
import { requestSettingsSection } from '../lib/settingsSection';

export function computerUsePaletteActions(onNavigate: (tab: string) => void) {
  return [
    {
      id: 'computer-use-open-settings',
      label: 'Open Computer Use settings',
      description: 'Let agents operate desktop apps on this machine',
      icon: MousePointerClick,
      group: 'Navigation',
      keywords: ['computer', 'desktop', 'automation', 'screen', 'settings'],
      onSelect: () => {
        requestSettingsSection('computer-use');
        onNavigate('settings');
      },
    },
  ];
}
