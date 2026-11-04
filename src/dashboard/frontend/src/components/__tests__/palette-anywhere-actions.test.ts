import { describe, expect, it, vi, beforeEach } from 'vitest';

import { anywherePaletteActions, ANYWHERE_PALETTE_GROUP } from '../palette-anywhere-actions';
import { openAnywhereDialog } from '../Settings/anywhere/anywhereDialogStore';
import { requestSettingsSection } from '../../lib/settingsSection';

vi.mock('../Settings/anywhere/anywhereDialogStore', () => ({ openAnywhereDialog: vi.fn() }));
vi.mock('../../lib/settingsSection', () => ({ requestSettingsSection: vi.fn() }));

const DIALOG_ROWS: ReadonlyArray<{ id: string; label: string; dialog: string }> = [
  { id: 'anywhere-link-machine', label: 'Link a machine', dialog: 'link-machine' },
  { id: 'anywhere-add-fly-machine', label: 'Add a Fly machine', dialog: 'add-fly-machine' },
  { id: 'anywhere-add-ssh-machine', label: 'Add an SSH machine', dialog: 'add-ssh-machine' },
  { id: 'anywhere-set-up-phone', label: 'Set up a phone', dialog: 'set-up-phone' },
  { id: 'anywhere-pair-device', label: 'Pair a device', dialog: 'pair-device' },
  { id: 'anywhere-tailscale-setup', label: 'Set up Tailscale', dialog: 'tailscale-setup' },
  { id: 'anywhere-connect-bot', label: 'Connect a bot', dialog: 'connect-bot' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('anywherePaletteActions', () => {
  it('lists the eight Anywhere actions in order', () => {
    const onNavigate = vi.fn();
    const actions = anywherePaletteActions(onNavigate);
    expect(actions.map((a) => a.label)).toEqual([
      'Link a machine',
      'Add a Fly machine',
      'Add an SSH machine',
      'Set up a phone',
      'Pair a device',
      'Set up Tailscale',
      'Connect a bot',
      'Open Anywhere settings',
    ]);
    expect(actions.every((a) => a.group === ANYWHERE_PALETTE_GROUP)).toBe(true);
  });

  it.each(DIALOG_ROWS)('$label opens its dialog', ({ id, dialog }) => {
    const onNavigate = vi.fn();
    const actions = anywherePaletteActions(onNavigate);
    const action = actions.find((a) => a.id === id)!;
    action.onSelect();
    expect(openAnywhereDialog).toHaveBeenCalledWith(dialog);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('Open Anywhere settings scrolls and navigates', () => {
    const onNavigate = vi.fn();
    const actions = anywherePaletteActions(onNavigate);
    const action = actions.find((a) => a.id === 'anywhere-open-settings')!;
    action.onSelect();
    expect(requestSettingsSection).toHaveBeenCalledWith('anywhere');
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});
