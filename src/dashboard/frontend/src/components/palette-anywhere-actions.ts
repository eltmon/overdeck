/**
 * Command-palette actions for Overdeck Anywhere (PAN-4869). Seven open the same
 * dialog the Settings → Anywhere buttons open, over the current page, through
 * the Anywhere dialog host; "Open Anywhere settings" navigates. Rows are
 * structurally typed like palette-fleet-hits.tsx to avoid importing CommandPalette.
 */
import { Bot, Cloud, Globe, Link2, QrCode, Server, Settings, Smartphone } from 'lucide-react';
import { openAnywhereDialog, type AnywhereDialog } from './Settings/anywhere/anywhereDialogStore';
import { requestSettingsSection } from '../lib/settingsSection';

export const ANYWHERE_PALETTE_GROUP = 'Anywhere';

interface AnywhereDialogRow {
  id: string;
  label: string;
  icon: React.ElementType;
  dialog: AnywhereDialog;
  description: string;
  keywords: string[];
}

const DIALOG_ROWS: readonly AnywhereDialogRow[] = [
  {
    id: 'anywhere-link-machine',
    label: 'Link a machine',
    icon: Link2,
    dialog: 'link-machine',
    description: "Paste another machine's pairing link",
    keywords: ['anywhere', 'machine', 'remote', 'link'],
  },
  {
    id: 'anywhere-add-fly-machine',
    label: 'Add a Fly machine',
    icon: Cloud,
    dialog: 'add-fly-machine',
    description: 'Start and link a Fly.io VM that runs Overdeck',
    keywords: ['anywhere', 'machine', 'remote', 'fly'],
  },
  {
    id: 'anywhere-add-ssh-machine',
    label: 'Add an SSH machine',
    icon: Server,
    dialog: 'add-ssh-machine',
    description: 'Link a machine you reach over SSH',
    keywords: ['anywhere', 'machine', 'remote', 'ssh'],
  },
  {
    id: 'anywhere-set-up-phone',
    label: 'Set up a phone',
    icon: Smartphone,
    dialog: 'set-up-phone',
    description: 'Reach this machine from your phone',
    keywords: ['anywhere', 'remote', 'phone'],
  },
  {
    id: 'anywhere-pair-device',
    label: 'Pair a device',
    icon: QrCode,
    dialog: 'pair-device',
    description: 'Create a pairing link for a laptop or browser',
    keywords: ['anywhere', 'remote', 'pair', 'qr'],
  },
  {
    id: 'anywhere-tailscale-setup',
    label: 'Set up Tailscale',
    icon: Globe,
    dialog: 'tailscale-setup',
    description: 'Reach this machine over your tailnet',
    keywords: ['anywhere', 'remote', 'tailscale'],
  },
  {
    id: 'anywhere-connect-bot',
    label: 'Connect a bot',
    icon: Bot,
    dialog: 'connect-bot',
    description: 'Give Hermes, OpenClaw or Grok access to this machine',
    keywords: ['anywhere', 'bot', 'mcp', 'hermes', 'openclaw', 'grok'],
  },
];

export function anywherePaletteActions(onNavigate: (tab: string) => void) {
  return [
    ...DIALOG_ROWS.map((row) => ({
      id: row.id,
      label: row.label,
      description: row.description,
      icon: row.icon,
      group: ANYWHERE_PALETTE_GROUP,
      keywords: row.keywords,
      onSelect: () => openAnywhereDialog(row.dialog),
    })),
    {
      id: 'anywhere-open-settings',
      label: 'Open Anywhere settings',
      description: 'Machines, devices, Tailscale and access tokens',
      icon: Settings,
      group: ANYWHERE_PALETTE_GROUP,
      keywords: ['anywhere', 'machine', 'remote', 'settings'],
      onSelect: () => {
        requestSettingsSection('anywhere');
        onNavigate('settings');
      },
    },
  ];
}
