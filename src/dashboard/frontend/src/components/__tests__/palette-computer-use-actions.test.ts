import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computerUsePaletteActions } from '../palette-computer-use-actions';
import { requestSettingsSection } from '../../lib/settingsSection';

vi.mock('../../lib/settingsSection', () => ({ requestSettingsSection: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computerUsePaletteActions (PAN-5461)', () => {
  it('offers Open Computer Use settings in Navigation with its keywords', () => {
    const [action, ...rest] = computerUsePaletteActions(vi.fn());
    expect(rest).toEqual([]);
    expect(action).toMatchObject({
      id: 'computer-use-open-settings',
      label: 'Open Computer Use settings',
      group: 'Navigation',
    });
    expect(action!.keywords).toEqual(expect.arrayContaining(['computer', 'desktop', 'automation', 'screen']));
  });

  it('opens the computer-use section of Settings', () => {
    const onNavigate = vi.fn();
    computerUsePaletteActions(onNavigate)[0]!.onSelect();
    expect(requestSettingsSection).toHaveBeenCalledWith('computer-use');
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});
